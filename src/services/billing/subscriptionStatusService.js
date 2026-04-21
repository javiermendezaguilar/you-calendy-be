const stripe = require("./stripeClient");
const {
  stripeSubscriptionSchema,
} = require("./subscriptionRuntimeSchemas");

const NON_TRIAL_STATUSES = new Set([
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

const normalizeStripeSubscription = (subscription) =>
  stripeSubscriptionSchema.parse(subscription);

const shouldIgnoreStaleSubscriptionEvent = (business, subscriptionId, allowReplace) => {
  if (!business.stripeSubscriptionId || !subscriptionId) {
    return false;
  }

  if (business.stripeSubscriptionId === subscriptionId) {
    return false;
  }

  return !allowReplace;
};

const updateBusinessSubscriptionStatus = async (
  business,
  rawSubscription,
  options = {}
) => {
  const subscription = normalizeStripeSubscription(rawSubscription);
  const allowReplace = options.allowReplace === true;

  if (
    shouldIgnoreStaleSubscriptionEvent(
      business,
      subscription.id,
      allowReplace
    )
  ) {
    return {
      updated: false,
      stale: true,
      reason: "stale_subscription_event",
      status: business.subscriptionStatus,
    };
  }

  business.stripeSubscriptionId = subscription.id;

  if (typeof subscription.customer === "string" && subscription.customer) {
    business.stripeCustomerId = subscription.customer;
  }

  business.subscriptionStatus = subscription.status;

  if (subscription.status === "active") {
    business.trialStart = null;
    business.trialEnd = null;
  } else if (NON_TRIAL_STATUSES.has(subscription.status)) {
    business.trialEnd = business.trialEnd || null;
  }

  await business.save();

  return {
    updated: true,
    stale: false,
    reason: "synced",
    status: subscription.status,
  };
};

const reconcileBusinessSubscriptionStatus = async (business) => {
  if (!business?.stripeSubscriptionId) {
    return {
      updated: false,
      reconciled: false,
      source: "local",
      reason: "missing_subscription_id",
      status: business?.subscriptionStatus || "none",
    };
  }

  const subscription = await stripe.subscriptions.retrieve(
    business.stripeSubscriptionId
  );

  const result = await updateBusinessSubscriptionStatus(business, subscription, {
    allowReplace: true,
  });

  return {
    ...result,
    reconciled: true,
    source: "stripe",
    subscriptionId: subscription.id,
  };
};

module.exports = {
  normalizeStripeSubscription,
  updateBusinessSubscriptionStatus,
  reconcileBusinessSubscriptionStatus,
};
