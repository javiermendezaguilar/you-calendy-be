const SUBSCRIPTION_STATUS_PRIORITY = {
  none: 0,
  incomplete: 1,
  incomplete_expired: 2,
  trialing: 3,
  active: 4,
  past_due: 5,
  canceled: 6,
  unpaid: 7,
  paused: 8,
};

const getSubscriptionStatusPriority = (status) =>
  SUBSCRIPTION_STATUS_PRIORITY[status] || 0;

const updateBusinessSubscriptionStatus = async (business, subscription) => {
  const currentPriority = getSubscriptionStatusPriority(
    business.subscriptionStatus
  );
  const nextPriority = getSubscriptionStatusPriority(subscription.status);

  if (nextPriority < currentPriority) {
    return false;
  }

  if (subscription.id) {
    business.stripeSubscriptionId = subscription.id;
  }

  if (subscription.customer) {
    business.stripeCustomerId = subscription.customer;
  }

  business.subscriptionStatus = subscription.status;

  if (subscription.status === "active") {
    business.trialEnd = null;
    business.trialStart = null;
  }

  await business.save();
  return true;
};

module.exports = {
  getSubscriptionStatusPriority,
  updateBusinessSubscriptionStatus,
};
