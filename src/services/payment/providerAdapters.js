const {
  PAYMENT_PROVIDER,
  PAYMENT_SCOPE,
} = require("./paymentScope");

const STRIPE_REFERENCE_TYPE = Object.freeze({
  CHECKOUT_SESSION: "checkout_session",
  INVOICE: "invoice",
  PAYMENT_INTENT: "payment_intent",
  SUBSCRIPTION: "subscription",
});

const normalizeAmount = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return 0;
  }

  return Number(amount.toFixed(2));
};

const normalizeCurrency = (value, fallback = "USD") => {
  const normalized = String(value || fallback).trim().toUpperCase();
  return normalized || fallback;
};

const toStripeCurrency = (value) => normalizeCurrency(value).toLowerCase();

const toStripeMinorUnit = (amount) => Math.round(normalizeAmount(amount) * 100);

const fromStripeMinorUnit = (amount) =>
  normalizeAmount((Number(amount) || 0) / 100);

const rawProviderReference = (id) => String(id || "").trim();

const buildProviderReference = (type, id) => {
  const normalizedId = rawProviderReference(id);
  return normalizedId ? `${type}:${normalizedId}` : "";
};

const buildStripeIdempotencyKey = (...parts) =>
  parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(":");

const getStripeEventObject = (event) => event?.data?.object || {};

const getStripePaymentIntentReference = (paymentIntent) =>
  buildProviderReference(STRIPE_REFERENCE_TYPE.PAYMENT_INTENT, paymentIntent?.id);

const isStripePolicyChargePaymentIntent = (paymentIntent) =>
  Boolean(
    paymentIntent?.metadata?.policyChargeId ||
      paymentIntent?.metadata?.policyChargeType
  );

const buildPolicyChargeMetadata = ({ charge, business, appointment, client }) => ({
  policyChargeId: String(charge?._id || charge?.id || ""),
  policyChargeType: charge?.type || "",
  businessId: String(business?._id || business?.id || ""),
  appointmentId: String(appointment?._id || appointment?.id || ""),
  clientId: String(client?._id || client?.id || ""),
  saveCardOnFile: charge?.saveCardOnFile ? "true" : "false",
});

const buildPolicyChargeIntentPayload = ({
  amount,
  currency,
  customerId,
  saveCardOnFile = false,
  metadata = {},
}) => ({
  amount: toStripeMinorUnit(amount),
  currency: toStripeCurrency(currency),
  customer: customerId,
  automatic_payment_methods: {
    enabled: true,
  },
  ...(saveCardOnFile ? { setup_future_usage: "off_session" } : {}),
  metadata,
});

const classifyStripeWebhookEvent = (event) => {
  const eventType = event?.type || "";
  const object = getStripeEventObject(event);

  if (
    eventType === "payment_intent.succeeded" ||
    eventType === "payment_intent.payment_failed"
  ) {
    if (!isStripePolicyChargePaymentIntent(object)) {
      return {
        provider: PAYMENT_PROVIDER.STRIPE,
        eventType,
        targetScope: null,
        providerReference: getStripePaymentIntentReference(object),
        reason: "unhandled_payment_intent",
      };
    }

    return {
      provider: PAYMENT_PROVIDER.STRIPE,
      eventType,
      targetScope: PAYMENT_SCOPE.COMMERCE_POLICY,
      providerReference: getStripePaymentIntentReference(object),
      providerEventId: event?.id || "",
      providerResourceId: object?.id || "",
      action:
        eventType === "payment_intent.succeeded"
          ? "policy_charge_succeeded"
          : "policy_charge_failed",
    };
  }

  if (eventType === "checkout.session.completed") {
    const providerReference = buildProviderReference(
      STRIPE_REFERENCE_TYPE.CHECKOUT_SESSION,
      object?.id
    );
    const isCreditPurchase = object?.metadata?.type === "credit_purchase";
    const isSubscriptionCheckout = object?.mode === "subscription";

    return {
      provider: PAYMENT_PROVIDER.STRIPE,
      eventType,
      targetScope:
        isCreditPurchase || isSubscriptionCheckout
          ? PAYMENT_SCOPE.PLATFORM_BILLING
          : null,
      providerReference,
      providerEventId: event?.id || "",
      providerResourceId: object?.id || "",
      action: isCreditPurchase
        ? "credit_purchase_completed"
        : isSubscriptionCheckout
          ? "subscription_checkout_completed"
          : "unsupported_checkout_mode",
    };
  }

  if (
    eventType === "invoice.paid" ||
    eventType === "invoice.payment_failed" ||
    eventType === "invoice.voided"
  ) {
    return {
      provider: PAYMENT_PROVIDER.STRIPE,
      eventType,
      targetScope: PAYMENT_SCOPE.PLATFORM_BILLING,
      providerReference: buildProviderReference(
        STRIPE_REFERENCE_TYPE.INVOICE,
        object?.id
      ),
      providerEventId: event?.id || "",
      providerResourceId: object?.id || "",
      action: eventType.replace(".", "_"),
    };
  }

  if (
    eventType === "customer.subscription.updated" ||
    eventType === "customer.subscription.created" ||
    eventType === "customer.subscription.deleted"
  ) {
    return {
      provider: PAYMENT_PROVIDER.STRIPE,
      eventType,
      targetScope: PAYMENT_SCOPE.PLATFORM_BILLING,
      providerReference: buildProviderReference(
        STRIPE_REFERENCE_TYPE.SUBSCRIPTION,
        object?.id
      ),
      providerEventId: event?.id || "",
      providerResourceId: object?.id || "",
      action: eventType.replace(/\./g, "_"),
    };
  }

  return {
    provider: PAYMENT_PROVIDER.STRIPE,
    eventType,
    targetScope: null,
    providerReference: "",
    reason: "unhandled_event_type",
  };
};

const stripePaymentProvider = Object.freeze({
  provider: PAYMENT_PROVIDER.STRIPE,
  method: "stripe",
  referenceTypes: STRIPE_REFERENCE_TYPE,
  references: Object.freeze({
    checkoutSession: (id) =>
      buildProviderReference(STRIPE_REFERENCE_TYPE.CHECKOUT_SESSION, id),
    invoice: (id) => buildProviderReference(STRIPE_REFERENCE_TYPE.INVOICE, id),
    paymentIntent: (id) =>
      buildProviderReference(STRIPE_REFERENCE_TYPE.PAYMENT_INTENT, id),
    raw: rawProviderReference,
  }),
  normalizeAmount,
  normalizeCurrency,
  toProviderCurrency: toStripeCurrency,
  toMinorUnit: toStripeMinorUnit,
  fromMinorUnit: fromStripeMinorUnit,
  buildIdempotencyKey: buildStripeIdempotencyKey,
  buildPolicyChargeMetadata,
  buildPolicyChargeIntentPayload,
  classifyWebhookEvent: classifyStripeWebhookEvent,
  isPolicyChargePaymentIntent: isStripePolicyChargePaymentIntent,
});

module.exports = {
  stripePaymentProvider,
};
