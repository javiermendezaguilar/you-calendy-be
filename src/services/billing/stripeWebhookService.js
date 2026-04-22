const stripe = require("./stripeClient");
const CreditProduct = require("../../models/creditProduct");
const Business = require("../../models/User/business");
const Payment = require("../../models/payment");
const {
  stripeCheckoutSessionSchema,
  stripeInvoiceSchema,
  stripeSubscriptionSchema,
} = require("./subscriptionRuntimeSchemas");
const {
  updateBusinessSubscriptionStatus,
} = require("./subscriptionStatusService");
const {
  PAYMENT_PROVIDER,
  PAYMENT_SCOPE,
} = require("../payment/paymentScope");

const normalizeStripeAmount = (value) => {
  const normalizedValue = Number(value);
  if (Number.isNaN(normalizedValue) || normalizedValue < 0) {
    return 0;
  }

  return Number((normalizedValue / 100).toFixed(2));
};

const normalizeCurrency = (value, fallback = "USD") => {
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  return (normalizedValue || fallback).toUpperCase();
};

const buildPlatformBillingSnapshot = (amount) => ({
  subtotal: amount,
  discountTotal: 0,
  total: amount,
  sourcePrice: amount,
  service: {
    id: null,
    name: "",
  },
  client: {
    id: null,
    firstName: "",
    lastName: "",
  },
  discounts: {
    promotionAmount: 0,
    flashSaleAmount: 0,
  },
});

const resolveInvoiceAmount = (invoice) => {
  if (typeof invoice.amount_paid === "number" && invoice.amount_paid > 0) {
    return normalizeStripeAmount(invoice.amount_paid);
  }

  if (typeof invoice.amount_due === "number" && invoice.amount_due >= 0) {
    return normalizeStripeAmount(invoice.amount_due);
  }

  if (typeof invoice.total === "number" && invoice.total >= 0) {
    return normalizeStripeAmount(invoice.total);
  }

  if (
    typeof invoice.amount_remaining === "number" &&
    invoice.amount_remaining >= 0
  ) {
    return normalizeStripeAmount(invoice.amount_remaining);
  }

  return 0;
};

const upsertPlatformBillingPayment = async ({
  business,
  status = "captured",
  amount,
  currency,
  providerReference,
  providerEventId,
  providerCustomerId = "",
  providerSubscriptionId = "",
  reference = "",
  capturedAt = new Date(),
  failedAt = null,
  failureReason = "",
  voidedAt = null,
  voidReason = "",
}) => {
  if (!providerReference) {
    throw new Error("Platform billing payments require a provider reference");
  }

  const existingPayment = await Payment.findOne({
    paymentScope: PAYMENT_SCOPE.PLATFORM_BILLING,
    provider: PAYMENT_PROVIDER.STRIPE,
    providerReference,
  });

  if (existingPayment) {
    if (existingPayment.status === "captured" && status !== "captured") {
      return existingPayment;
    }

    existingPayment.status = status;
    existingPayment.providerEventId = providerEventId || existingPayment.providerEventId;
    existingPayment.providerCustomerId =
      providerCustomerId || existingPayment.providerCustomerId;
    existingPayment.providerSubscriptionId =
      providerSubscriptionId || existingPayment.providerSubscriptionId;
    existingPayment.currency = normalizeCurrency(
      currency,
      existingPayment.currency || "USD"
    );
    existingPayment.amount = amount;
    existingPayment.reference = reference || existingPayment.reference;
    existingPayment.snapshot = buildPlatformBillingSnapshot(amount);

    if (status === "captured") {
      existingPayment.capturedAt = capturedAt;
      existingPayment.failedAt = null;
      existingPayment.failureReason = "";
      existingPayment.voidedAt = null;
      existingPayment.voidReason = "";
    }

    if (status === "failed") {
      existingPayment.failedAt = failedAt || new Date();
      existingPayment.failureReason = failureReason || "";
      existingPayment.voidedAt = null;
      existingPayment.voidReason = "";
    }

    if (status === "voided") {
      existingPayment.voidedAt = voidedAt || new Date();
      existingPayment.voidReason = voidReason || "";
    }

    await existingPayment.save();
    return existingPayment;
  }

  return Payment.create({
    paymentScope: PAYMENT_SCOPE.PLATFORM_BILLING,
    business: business._id,
    status,
    method: "stripe",
    provider: PAYMENT_PROVIDER.STRIPE,
    providerReference,
    providerEventId,
    providerCustomerId,
    providerSubscriptionId,
    currency: normalizeCurrency(currency),
    amount,
    tip: 0,
    reference,
    capturedAt,
    capturedBy: business.owner || null,
    failedAt,
    failureReason,
    voidedAt,
    voidReason,
    snapshot: buildPlatformBillingSnapshot(amount),
  });
};

const extractBusinessIdFromInvoice = (invoice) =>
  invoice.metadata?.businessId ||
  invoice.parent?.subscription_details?.metadata?.businessId ||
  invoice.lines?.data?.find((line) => line.metadata?.businessId)?.metadata
    ?.businessId ||
  null;

const getStripeWebhookSecretInfo = () => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return {
      value: "",
      source: null,
      usesLegacyFallback: false,
    };
  }

  return {
    value: process.env.STRIPE_WEBHOOK_SECRET,
    source: "STRIPE_WEBHOOK_SECRET",
    usesLegacyFallback: false,
  };
};

const getStripeWebhookSecret = () => getStripeWebhookSecretInfo().value;

const logStripeWebhookSecretMode = (logger = console) => {
  const info = getStripeWebhookSecretInfo();

  if (!info.source) {
    logger.error("Stripe webhook secret is not configured");
    return info;
  }

  logger.log("Stripe webhook secret source: STRIPE_WEBHOOK_SECRET");
  return info;
};

const processCreditPurchaseSession = async (session) => {
  const businessId = session.metadata?.businessId;
  const ownerId = session.metadata?.ownerId;

  if (!businessId) {
    throw new Error("Business ID not found in session metadata");
  }

  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 1,
  });

  const priceId =
    lineItems.data[0]?.price?.id || session.line_items?.[0]?.price?.id;

  if (!priceId) {
    throw new Error("No price found in session");
  }

  const productDoc = await CreditProduct.findOne({
    stripePriceId: priceId,
    isActive: true,
  });

  if (!productDoc) {
    throw new Error("No matching active credit product found");
  }

  const business = await Business.findById(businessId);

  if (!business) {
    throw new Error("Business not found");
  }

  if (ownerId && business.owner.toString() !== ownerId) {
    throw new Error("Business owner mismatch");
  }

  business.smsCredits = (business.smsCredits || 0) + (productDoc.smsCredits || 0);
  business.emailCredits =
    (business.emailCredits || 0) + (productDoc.emailCredits || 0);

  await business.save();
  await upsertPlatformBillingPayment({
    business,
    status: "captured",
    amount:
      typeof session.amount_total === "number"
        ? normalizeStripeAmount(session.amount_total)
        : Number(productDoc.amount) || 0,
    currency: session.currency || productDoc.currency || "USD",
    providerReference: `checkout_session:${session.id}`,
    providerEventId: session.id,
    reference: session.id,
  });

  return "Credits added successfully";
};

const processSubscriptionCheckoutSession = async (session) => {
  const normalizedSession = stripeCheckoutSessionSchema.parse(session);
  const businessId = normalizedSession.metadata?.businessId;

  if (!businessId || normalizedSession.mode !== "subscription") {
    return "Unhandled event";
  }

  const business = await Business.findById(businessId);

  if (!business) {
    return "Business not found, skipping";
  }

  const subscription = await stripe.subscriptions.retrieve(
    normalizedSession.subscription
  );
  const normalizedSubscription = {
    ...subscription,
    metadata: {
      ...(subscription.metadata || {}),
      businessId,
    },
  };

  await updateBusinessSubscriptionStatus(business, normalizedSubscription, {
    allowReplace: true,
  });

  return "Subscription activated";
};

const processSubscriptionLifecycleEvent = async (subscription, fallbackStatus) => {
  const normalizedSubscription = stripeSubscriptionSchema.parse({
    ...subscription,
    status: fallbackStatus || subscription.status,
  });
  const businessId = normalizedSubscription.metadata?.businessId;

  if (!businessId) {
    return "Subscription metadata missing businessId, skipping";
  }

  const business = await Business.findById(businessId);

  if (!business) {
    return "Business not found, skipping";
  }

  const result = await updateBusinessSubscriptionStatus(
    business,
    normalizedSubscription,
    { allowReplace: false }
  );

  if (result.stale) {
    return "Stale subscription event ignored";
  }

  if (normalizedSubscription.status === "canceled") {
    return "Subscription canceled";
  }

  return "Subscription updated";
};

const processInvoicePaidEvent = async (invoice, eventId) => {
  const normalizedInvoice = stripeInvoiceSchema.parse(invoice);
  const businessId = extractBusinessIdFromInvoice(normalizedInvoice);

  if (!businessId) {
    return "Invoice metadata missing businessId, skipping";
  }

  const business = await Business.findById(businessId);

  if (!business) {
    return "Business not found, skipping";
  }

  const paidAtSeconds = normalizedInvoice.status_transitions?.paid_at;
  const capturedAt =
    typeof paidAtSeconds === "number"
      ? new Date(paidAtSeconds * 1000)
      : new Date((normalizedInvoice.created || Math.floor(Date.now() / 1000)) * 1000);

  await upsertPlatformBillingPayment({
    business,
    status: "captured",
    amount: normalizeStripeAmount(normalizedInvoice.amount_paid),
    currency: normalizedInvoice.currency || "USD",
    providerReference: `invoice:${normalizedInvoice.id}`,
    providerEventId: eventId,
    providerCustomerId: normalizedInvoice.customer || "",
    providerSubscriptionId: normalizedInvoice.subscription || "",
    reference: normalizedInvoice.number || normalizedInvoice.id,
    capturedAt,
  });

  return "Invoice payment recorded";
};

const syncBusinessSubscriptionFromInvoice = async (business, invoice) => {
  if (!invoice.subscription) {
    return null;
  }

  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
  return updateBusinessSubscriptionStatus(business, subscription, {
    allowReplace: false,
  });
};

const processInvoicePaymentFailedEvent = async (invoice, eventId) => {
  const normalizedInvoice = stripeInvoiceSchema.parse(invoice);
  const businessId = extractBusinessIdFromInvoice(normalizedInvoice);

  if (!businessId) {
    return "Invoice metadata missing businessId, skipping";
  }

  const business = await Business.findById(businessId);
  if (!business) {
    return "Business not found, skipping";
  }

  await upsertPlatformBillingPayment({
    business,
    status: "failed",
    amount: resolveInvoiceAmount(normalizedInvoice),
    currency: normalizedInvoice.currency || "USD",
    providerReference: `invoice:${normalizedInvoice.id}`,
    providerEventId: eventId,
    providerCustomerId: normalizedInvoice.customer || "",
    providerSubscriptionId: normalizedInvoice.subscription || "",
    reference: normalizedInvoice.number || normalizedInvoice.id,
    failedAt: new Date(
      (normalizedInvoice.created || Math.floor(Date.now() / 1000)) * 1000
    ),
    failureReason: normalizedInvoice.status || "payment_failed",
  });

  await syncBusinessSubscriptionFromInvoice(business, normalizedInvoice);
  return "Invoice payment failure recorded";
};

const processInvoiceVoidedEvent = async (invoice, eventId) => {
  const normalizedInvoice = stripeInvoiceSchema.parse(invoice);
  const businessId = extractBusinessIdFromInvoice(normalizedInvoice);

  if (!businessId) {
    return "Invoice metadata missing businessId, skipping";
  }

  const business = await Business.findById(businessId);
  if (!business) {
    return "Business not found, skipping";
  }

  await upsertPlatformBillingPayment({
    business,
    status: "voided",
    amount: resolveInvoiceAmount(normalizedInvoice),
    currency: normalizedInvoice.currency || "USD",
    providerReference: `invoice:${normalizedInvoice.id}`,
    providerEventId: eventId,
    providerCustomerId: normalizedInvoice.customer || "",
    providerSubscriptionId: normalizedInvoice.subscription || "",
    reference: normalizedInvoice.number || normalizedInvoice.id,
    voidedAt: new Date(
      (normalizedInvoice.created || Math.floor(Date.now() / 1000)) * 1000
    ),
    voidReason: normalizedInvoice.status || "invoice_voided",
  });

  return "Invoice void recorded";
};

const processStripeWebhookEvent = async (event) => {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    if (session.metadata?.type === "credit_purchase") {
      return processCreditPurchaseSession(session);
    }

    return processSubscriptionCheckoutSession(session);
  }

  if (event.type === "invoice.paid") {
    return processInvoicePaidEvent(event.data.object, event.id || "");
  }

  if (event.type === "invoice.payment_failed") {
    return processInvoicePaymentFailedEvent(event.data.object, event.id || "");
  }

  if (event.type === "invoice.voided") {
    return processInvoiceVoidedEvent(event.data.object, event.id || "");
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.created"
  ) {
    return processSubscriptionLifecycleEvent(event.data.object);
  }

  if (event.type === "customer.subscription.deleted") {
    return processSubscriptionLifecycleEvent(event.data.object, "canceled");
  }

  return "Unhandled event";
};

module.exports = {
  getStripeWebhookSecret,
  getStripeWebhookSecretInfo,
  logStripeWebhookSecretMode,
  processStripeWebhookEvent,
};
