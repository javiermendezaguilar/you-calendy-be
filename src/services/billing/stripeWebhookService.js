const stripe = require("./stripeClient");
const CreditProduct = require("../../models/creditProduct");
const Business = require("../../models/User/business");
const {
  stripeCheckoutSessionSchema,
  stripeSubscriptionSchema,
} = require("./subscriptionRuntimeSchemas");
const {
  updateBusinessSubscriptionStatus,
} = require("./subscriptionStatusService");

const getStripeWebhookSecret = () =>
  process.env.STRIPE_WEBHOOK_SECRET ||
  process.env.WEBHOOK_SECRET_ONE ||
  process.env.WEBHOOK_SECRET_TWO ||
  "";

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

const processStripeWebhookEvent = async (event) => {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    if (session.metadata?.type === "credit_purchase") {
      return processCreditPurchaseSession(session);
    }

    return processSubscriptionCheckoutSession(session);
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
  processStripeWebhookEvent,
};
