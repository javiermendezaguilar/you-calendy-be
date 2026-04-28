const mongoose = require("mongoose");
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
  extractSubscriptionPriceId,
  resolveActivePlanSnapshotByPriceId,
} = require("./subscriptionPlanService");
const {
  PAYMENT_PROVIDER,
  PAYMENT_SCOPE,
} = require("../payment/paymentScope");
const { stripePaymentProvider } = require("../payment/providerAdapters");
const {
  processPolicyChargePaymentFailed,
  processPolicyChargePaymentSucceeded,
} = require("../payment/policyChargeService");

const normalizeStripeAmount = stripePaymentProvider.fromMinorUnit;

const normalizeCurrency = stripePaymentProvider.normalizeCurrency;

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
  mongoSession = null,
}) => {
  if (!providerReference) {
    throw new Error("Platform billing payments require a provider reference");
  }

  const existingPaymentQuery = Payment.findOne({
    paymentScope: PAYMENT_SCOPE.PLATFORM_BILLING,
    provider: PAYMENT_PROVIDER.STRIPE,
    providerReference,
  });
  if (mongoSession) {
    existingPaymentQuery.session(mongoSession);
  }
  const existingPayment = await existingPaymentQuery;

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

    await existingPayment.save(
      mongoSession ? { session: mongoSession } : undefined
    );
    return {
      payment: existingPayment,
      action: "updated_existing_payment",
    };
  }

  const paymentPayload = {
    paymentScope: PAYMENT_SCOPE.PLATFORM_BILLING,
    business: business._id,
    status,
    method: stripePaymentProvider.method,
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
  };

  const payment = mongoSession
    ? (await Payment.create([paymentPayload], { session: mongoSession }))[0]
    : await Payment.create(paymentPayload);

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

const resolveStripeBillingBusiness = async ({
  businessId,
  subscriptionId,
  customerId,
}) => {
  if (businessId) {
    const business = await Business.findById(businessId);
    return {
      business,
      businessId,
      businessResolution: business
        ? "metadata_business_id"
        : "metadata_business_id_not_found",
      reason: business ? null : "business_not_found",
    };
  }

  if (subscriptionId) {
    const business = await Business.findOne({
      stripeSubscriptionId: subscriptionId,
    });

    if (business) {
      return {
        business,
        businessId: String(business._id),
        businessResolution: "subscription_id",
        reason: null,
      };
    }
  }

  if (customerId) {
    const business = await Business.findOne({
      stripeCustomerId: customerId,
    });

    if (business) {
      return {
        business,
        businessId: String(business._id),
        businessResolution: "customer_id",
        reason: null,
      };
    }
  }

  return {
    business: null,
    businessId: null,
    businessResolution: "not_resolved",
    reason: "business_not_resolved",
  };
};

const createStripeBillingBusinessNotResolvedResult = ({
  eventType,
  businessId,
  invoiceId,
  subscriptionId,
  customerId,
  businessResolution,
  reason,
}) =>
  createWebhookProcessingResult(
    "Stripe billing business not resolved, skipping",
    {
      eventType,
      businessId: businessId || null,
      invoiceId: invoiceId || null,
      subscriptionId: subscriptionId || "",
      customerId: customerId || "",
      businessResolution: businessResolution || "not_resolved",
      reason: reason || "business_not_resolved",
    }
  );

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

  const smsCreditsToAdd = productDoc.smsCredits || 0;
  const emailCreditsToAdd = productDoc.emailCredits || 0;
  const mongoSession = await mongoose.startSession();
  let payment;
  let action;
  let creditsApplied = false;

  try {
    await mongoSession.withTransaction(async () => {
      const result = await upsertPlatformBillingPayment({
        business,
        status: "captured",
        amount:
          typeof session.amount_total === "number"
            ? normalizeStripeAmount(session.amount_total)
            : Number(productDoc.amount) || 0,
        currency: session.currency || productDoc.currency || "USD",
        providerReference: stripePaymentProvider.references.checkoutSession(
          session.id
        ),
        providerEventId: session.id,
        reference: session.id,
        mongoSession,
      });

      payment = result.payment;
      action = result.action;
      creditsApplied = action === "created_payment";

      if (!creditsApplied) {
        return;
      }

      await Business.updateOne(
        { _id: business._id },
        {
          $inc: {
            smsCredits: smsCreditsToAdd,
            emailCredits: emailCreditsToAdd,
          },
        },
        { session: mongoSession }
      );
    });
  } finally {
    await mongoSession.endSession();
  }

  return createWebhookProcessingResult(
    creditsApplied ? "Credits added successfully" : "Credits already processed",
    {
      eventType: "checkout.session.completed",
      businessId: String(business._id),
      paymentId: String(payment._id),
      paymentScope: payment.paymentScope,
      paymentStatus: payment.status,
      providerReference: payment.providerReference,
      action,
      creditsApplied,
    }
  );
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
      planPriceId:
        normalizedSession.metadata?.planPriceId ||
        subscription.metadata?.planPriceId ||
        extractSubscriptionPriceId(subscription),
    },
  };
  const planSnapshot = await resolveActivePlanSnapshotByPriceId(
    normalizedSubscription.metadata.planPriceId
  );

  const result = await updateBusinessSubscriptionStatus(
    business,
    normalizedSubscription,
    {
      allowReplace: true,
      ...(planSnapshot ? { planSnapshot } : {}),
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

const processSubscriptionLifecycleEvent = async (
  subscription,
  fallbackStatus,
  sourceEventType = null
) => {
  const normalizedSubscription = stripeSubscriptionSchema.parse({
    ...subscription,
    status: fallbackStatus || subscription.status,
  });
  const planSnapshot = await resolveActivePlanSnapshotByPriceId(
    extractSubscriptionPriceId(subscription)
  );
  const eventType =
    sourceEventType || `customer.subscription.${normalizedSubscription.status}`;
  const businessId = normalizedSubscription.metadata?.businessId;
  const businessResolution = await resolveStripeBillingBusiness({
    businessId,
    subscriptionId: normalizedSubscription.id,
    customerId: normalizedSubscription.customer || "",
  });

  if (!businessResolution.business) {
    return createStripeBillingBusinessNotResolvedResult({
      eventType,
      businessId,
      subscriptionId: normalizedSubscription.id,
      customerId: normalizedSubscription.customer || "",
      businessResolution: businessResolution.businessResolution,
      reason: businessResolution.reason,
    });
  }

  const business = businessResolution.business;
  const result = await updateBusinessSubscriptionStatus(
    business,
    normalizedSubscription,
    {
      allowReplace: false,
      ...(planSnapshot ? { planSnapshot } : {}),
    }
  );

  if (result.stale) {
    return createWebhookProcessingResult("Stale subscription event ignored", {
      eventType,
      businessId: String(business._id),
      subscriptionId: normalizedSubscription.id,
      businessResolution: businessResolution.businessResolution,
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
      businessResolution: businessResolution.businessResolution,
      result: result.reason,
      subscriptionStatus: result.status,
    });
  }

  return createWebhookProcessingResult("Subscription updated", {
    eventType,
    businessId: String(business._id),
    subscriptionId: normalizedSubscription.id,
    customerId: normalizedSubscription.customer || "",
    businessResolution: businessResolution.businessResolution,
    result: result.reason,
    subscriptionStatus: result.status,
  });
};

const resolveInvoiceEventCapturedAt = (invoice) =>
  new Date((invoice.created || Math.floor(Date.now() / 1000)) * 1000);

const resolvePaidInvoiceCapturedAt = (invoice) => {
  const paidAtSeconds = invoice.status_transitions?.paid_at;
  return typeof paidAtSeconds === "number"
    ? new Date(paidAtSeconds * 1000)
    : resolveInvoiceEventCapturedAt(invoice);
};

const resolveInvoiceBillingContext = async (normalizedInvoice, eventType) => {
  const businessId = extractBusinessIdFromInvoice(normalizedInvoice);
  const businessResolution = await resolveStripeBillingBusiness({
    businessId,
    subscriptionId: normalizedInvoice.subscription || "",
    customerId: normalizedInvoice.customer || "",
  });

  if (!businessResolution.business) {
    return {
      unresolvedResult: createStripeBillingBusinessNotResolvedResult({
        eventType,
        businessId,
        invoiceId: normalizedInvoice.id,
        subscriptionId: normalizedInvoice.subscription || "",
        customerId: normalizedInvoice.customer || "",
        businessResolution: businessResolution.businessResolution,
        reason: businessResolution.reason,
      }),
    };
  }

  return {
    business: businessResolution.business,
    businessResolution: businessResolution.businessResolution,
  };
};

const buildInvoicePlatformBillingInput = ({
  business,
  normalizedInvoice,
  eventId,
  status,
  amount,
  capturedAt,
  failedAt = null,
  failureReason = "",
  voidedAt = null,
  voidReason = "",
}) => ({
  business,
  status,
  amount,
  currency: normalizedInvoice.currency || "USD",
  providerReference: stripePaymentProvider.references.invoice(
    normalizedInvoice.id
  ),
  providerEventId: eventId,
  providerCustomerId: normalizedInvoice.customer || "",
  providerSubscriptionId: normalizedInvoice.subscription || "",
  reference: normalizedInvoice.number || normalizedInvoice.id,
  capturedAt,
  failedAt,
  failureReason,
  voidedAt,
  voidReason,
});

const buildInvoiceWebhookMeta = ({
  eventType,
  business,
  normalizedInvoice,
  payment,
  action,
  businessResolution,
  subscriptionSyncResult,
}) => ({
  eventType,
  businessId: String(business._id),
  invoiceId: normalizedInvoice.id,
  subscriptionId: normalizedInvoice.subscription || "",
  paymentId: String(payment._id),
  paymentStatus: payment.status,
  providerReference: payment.providerReference,
  businessResolution,
  action,
  subscriptionSyncResult: subscriptionSyncResult
    ? subscriptionSyncResult.reason || "synced"
    : null,
  stale: Boolean(subscriptionSyncResult?.stale),
});

const processInvoicePaidEvent = async (invoice, eventId) => {
  const normalizedInvoice = stripeInvoiceSchema.parse(invoice);
  const invoiceContext = await resolveInvoiceBillingContext(
    normalizedInvoice,
    "invoice.paid"
  );
  if (invoiceContext.unresolvedResult) return invoiceContext.unresolvedResult;

  const business = invoiceContext.business;
  const capturedAt = resolvePaidInvoiceCapturedAt(normalizedInvoice);

  const { payment, action } = await upsertPlatformBillingPayment(
    buildInvoicePlatformBillingInput({
      business,
      normalizedInvoice,
      eventId,
      status: "captured",
      amount: normalizeStripeAmount(normalizedInvoice.amount_paid),
      capturedAt,
    })
  );

  const subscriptionSyncResult = await syncBusinessSubscriptionFromInvoice(
    business,
    normalizedInvoice
  );

  return createWebhookProcessingResult(
    "Invoice payment recorded",
    buildInvoiceWebhookMeta({
      eventType: "invoice.paid",
      business,
      normalizedInvoice,
      payment,
      action,
      businessResolution: invoiceContext.businessResolution,
      subscriptionSyncResult,
    })
  );
};

const syncBusinessSubscriptionFromInvoice = async (business, invoice) => {
  if (!invoice.subscription) {
    return null;
  }

  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
  if (!subscription?.id) {
    return {
      updated: false,
      stale: false,
      reason: "subscription_retrieve_empty",
      status: business.subscriptionStatus,
    };
  }

  const planSnapshot = await resolveActivePlanSnapshotByPriceId(
    extractSubscriptionPriceId(subscription)
  );

  return updateBusinessSubscriptionStatus(business, subscription, {
    allowReplace: false,
    ...(planSnapshot ? { planSnapshot } : {}),
  });
};

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
  const invoiceContext = await resolveInvoiceBillingContext(
    normalizedInvoice,
    eventType
  );
  if (invoiceContext.unresolvedResult) return invoiceContext.unresolvedResult;

  const business = invoiceContext.business;
  const eventDate = resolveInvoiceEventCapturedAt(normalizedInvoice);

  const { payment, action } = await upsertPlatformBillingPayment(
    buildInvoicePlatformBillingInput({
      business,
      normalizedInvoice,
      eventId,
      status,
      amount: resolveInvoiceAmount(normalizedInvoice),
      failedAt: status === "failed" ? eventDate : null,
      failureReason,
      voidedAt: status === "voided" ? eventDate : null,
      voidReason,
    })
  );

  const subscriptionSyncResult = syncSubscription
    ? await syncBusinessSubscriptionFromInvoice(business, normalizedInvoice)
    : null;

  return createWebhookProcessingResult(
    getInvoiceEventResultMessage(status),
    buildInvoiceWebhookMeta({
      eventType,
      business,
      normalizedInvoice,
      payment,
      action,
      businessResolution: invoiceContext.businessResolution,
      subscriptionSyncResult,
    })
  );
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
  if (event.type === "payment_intent.succeeded") {
    const providerEvent = stripePaymentProvider.classifyWebhookEvent(event);
    const paymentIntent = event.data.object;
    if (providerEvent.targetScope === PAYMENT_SCOPE.COMMERCE_POLICY) {
      return processPolicyChargePaymentSucceeded(paymentIntent, event.id || "");
    }
  }

  if (event.type === "payment_intent.payment_failed") {
    const providerEvent = stripePaymentProvider.classifyWebhookEvent(event);
    const paymentIntent = event.data.object;
    if (providerEvent.targetScope === PAYMENT_SCOPE.COMMERCE_POLICY) {
      return processPolicyChargePaymentFailed(paymentIntent, event.id || "");
    }
  }

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
    return processSubscriptionLifecycleEvent(
      event.data.object,
      null,
      event.type
    );
  }

  if (event.type === "customer.subscription.deleted") {
    return processSubscriptionLifecycleEvent(
      event.data.object,
      "canceled",
      event.type
    );
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
