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

const createWebhookProcessingResult = (message, meta = {}) => ({
  message,
  meta,
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
      return {
        payment: existingPayment,
        action: "ignored_captured_payment",
      };
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
    return {
      payment: existingPayment,
      action: "updated_existing_payment",
    };
  }

  const payment = await Payment.create({
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

  return {
    payment,
    action: "created_payment",
  };
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
  const { payment, action } = await upsertPlatformBillingPayment({
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

  return createWebhookProcessingResult("Credits added successfully", {
    eventType: "checkout.session.completed",
    businessId: String(business._id),
    paymentId: String(payment._id),
    paymentScope: payment.paymentScope,
    paymentStatus: payment.status,
    providerReference: payment.providerReference,
    action,
  });
};

const processSubscriptionCheckoutSession = async (session) => {
  const normalizedSession = stripeCheckoutSessionSchema.parse(session);
  const businessId = normalizedSession.metadata?.businessId;

  if (!businessId || normalizedSession.mode !== "subscription") {
    return createWebhookProcessingResult("Unhandled event", {
      eventType: "checkout.session.completed",
      reason: "unsupported_checkout_mode",
    });
  }

  const business = await Business.findById(businessId);

  if (!business) {
    return createWebhookProcessingResult("Business not found, skipping", {
      eventType: "checkout.session.completed",
      businessId,
      reason: "business_not_found",
    });
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

  const result = await updateBusinessSubscriptionStatus(
    business,
    normalizedSubscription,
    {
      allowReplace: true,
    }
  );

  return createWebhookProcessingResult("Subscription activated", {
    eventType: "checkout.session.completed",
    businessId: String(business._id),
    subscriptionId: normalizedSubscription.id,
    customerId: normalizedSubscription.customer || "",
    result: result.reason,
    subscriptionStatus: result.status,
  });
};

const processSubscriptionLifecycleEvent = async (subscription, fallbackStatus) => {
  const normalizedSubscription = stripeSubscriptionSchema.parse({
    ...subscription,
    status: fallbackStatus || subscription.status,
  });
  const businessId = normalizedSubscription.metadata?.businessId;

  if (!businessId) {
    return createWebhookProcessingResult(
      "Subscription metadata missing businessId, skipping",
      {
        eventType: `customer.subscription.${normalizedSubscription.status}`,
        subscriptionId: normalizedSubscription.id,
        reason: "missing_business_id",
      }
    );
  }

  const business = await Business.findById(businessId);

  if (!business) {
    return createWebhookProcessingResult("Business not found, skipping", {
      eventType: `customer.subscription.${normalizedSubscription.status}`,
      businessId,
      subscriptionId: normalizedSubscription.id,
      reason: "business_not_found",
    });
  }

  const result = await updateBusinessSubscriptionStatus(
    business,
    normalizedSubscription,
    { allowReplace: false }
  );

  if (result.stale) {
    return createWebhookProcessingResult("Stale subscription event ignored", {
      eventType: `customer.subscription.${normalizedSubscription.status}`,
      businessId: String(business._id),
      subscriptionId: normalizedSubscription.id,
      reason: result.reason,
      stale: true,
      subscriptionStatus: result.status,
    });
  }

  if (normalizedSubscription.status === "canceled") {
    return createWebhookProcessingResult("Subscription canceled", {
      eventType: "customer.subscription.deleted",
      businessId: String(business._id),
      subscriptionId: normalizedSubscription.id,
      customerId: normalizedSubscription.customer || "",
      result: result.reason,
      subscriptionStatus: result.status,
    });
  }

  return createWebhookProcessingResult("Subscription updated", {
    eventType: `customer.subscription.${normalizedSubscription.status}`,
    businessId: String(business._id),
    subscriptionId: normalizedSubscription.id,
    customerId: normalizedSubscription.customer || "",
    result: result.reason,
    subscriptionStatus: result.status,
  });
};

const processInvoicePaidEvent = async (invoice, eventId) => {
  const normalizedInvoice = stripeInvoiceSchema.parse(invoice);
  const businessId = extractBusinessIdFromInvoice(normalizedInvoice);

  if (!businessId) {
    return createWebhookProcessingResult("Invoice metadata missing businessId, skipping", {
      eventType: "invoice.paid",
      invoiceId: normalizedInvoice.id,
      reason: "missing_business_id",
    });
  }

  const business = await Business.findById(businessId);

  if (!business) {
    return createWebhookProcessingResult("Business not found, skipping", {
      eventType: "invoice.paid",
      businessId,
      invoiceId: normalizedInvoice.id,
      reason: "business_not_found",
    });
  }

  const paidAtSeconds = normalizedInvoice.status_transitions?.paid_at;
  const capturedAt =
    typeof paidAtSeconds === "number"
      ? new Date(paidAtSeconds * 1000)
      : new Date((normalizedInvoice.created || Math.floor(Date.now() / 1000)) * 1000);

  const { payment, action } = await upsertPlatformBillingPayment({
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

  return createWebhookProcessingResult("Invoice payment recorded", {
    eventType: "invoice.paid",
    businessId: String(business._id),
    invoiceId: normalizedInvoice.id,
    subscriptionId: normalizedInvoice.subscription || "",
    paymentId: String(payment._id),
    paymentStatus: payment.status,
    providerReference: payment.providerReference,
    action,
  });
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

const resolveInvoiceEventCapturedAt = (invoice) =>
  new Date((invoice.created || Math.floor(Date.now() / 1000)) * 1000);

const getInvoiceEventResultMessage = (status) => {
  if (status === "failed") {
    return "Invoice payment failure recorded";
  }

  if (status === "voided") {
    return "Invoice void recorded";
  }

  return "Invoice event recorded";
};

const processNegativeInvoiceEvent = async ({
  invoice,
  eventId,
  eventType,
  status,
  failureReason = "",
  voidReason = "",
  syncSubscription = false,
}) => {
  const normalizedInvoice = stripeInvoiceSchema.parse(invoice);
  const businessId = extractBusinessIdFromInvoice(normalizedInvoice);

  if (!businessId) {
    return createWebhookProcessingResult("Invoice metadata missing businessId, skipping", {
      eventType,
      invoiceId: normalizedInvoice.id,
      reason: "missing_business_id",
    });
  }

  const business = await Business.findById(businessId);
  if (!business) {
    return createWebhookProcessingResult("Business not found, skipping", {
      eventType,
      businessId,
      invoiceId: normalizedInvoice.id,
      reason: "business_not_found",
    });
  }

  const eventDate = resolveInvoiceEventCapturedAt(normalizedInvoice);

  const { payment, action } = await upsertPlatformBillingPayment({
    business,
    status,
    amount: resolveInvoiceAmount(normalizedInvoice),
    currency: normalizedInvoice.currency || "USD",
    providerReference: `invoice:${normalizedInvoice.id}`,
    providerEventId: eventId,
    providerCustomerId: normalizedInvoice.customer || "",
    providerSubscriptionId: normalizedInvoice.subscription || "",
    reference: normalizedInvoice.number || normalizedInvoice.id,
    failedAt: status === "failed" ? eventDate : null,
    failureReason,
    voidedAt: status === "voided" ? eventDate : null,
    voidReason,
  });

  const subscriptionSyncResult = syncSubscription
    ? await syncBusinessSubscriptionFromInvoice(business, normalizedInvoice)
    : null;

  return createWebhookProcessingResult(getInvoiceEventResultMessage(status), {
    eventType,
    businessId: String(business._id),
    invoiceId: normalizedInvoice.id,
    subscriptionId: normalizedInvoice.subscription || "",
    paymentId: String(payment._id),
    paymentStatus: payment.status,
    providerReference: payment.providerReference,
    action,
    subscriptionSyncResult: subscriptionSyncResult
      ? subscriptionSyncResult.reason || "synced"
      : null,
    stale: Boolean(subscriptionSyncResult?.stale),
  });
};

const processInvoicePaymentFailedEvent = async (invoice, eventId) =>
  processNegativeInvoiceEvent({
    invoice,
    eventId,
    eventType: "invoice.payment_failed",
    status: "failed",
    failureReason: stripeInvoiceSchema.parse(invoice).status || "payment_failed",
    syncSubscription: true,
  });

const processInvoiceVoidedEvent = async (invoice, eventId) =>
  processNegativeInvoiceEvent({
    invoice,
    eventId,
    eventType: "invoice.voided",
    status: "voided",
    voidReason: stripeInvoiceSchema.parse(invoice).status || "invoice_voided",
  });

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

  return createWebhookProcessingResult("Unhandled event", {
    eventType: event.type,
    reason: "unhandled_event_type",
  });
};

module.exports = {
  getStripeWebhookSecret,
  getStripeWebhookSecretInfo,
  logStripeWebhookSecretMode,
  processStripeWebhookEvent,
};
