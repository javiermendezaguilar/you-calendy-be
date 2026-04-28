const moment = require("moment");
const {
  PLATFORM_BILLING_SCOPE,
} = require("../payment/reportingScope");
const {
  normalizeFeatureKeys,
  normalizePlanLimits,
} = require("./subscriptionPlanService");

const CORE_FEATURE_KEYS = [
  "booking",
  "staff_management",
  "client_crm",
  "messaging",
  "campaigns",
  "operational_reporting",
  "credits_purchase",
];

const buildFeatureMap = (enabledFeatureKeys, canUseProduct) => {
  const enabled = new Set(canUseProduct ? enabledFeatureKeys : []);

  return CORE_FEATURE_KEYS.reduce((features, key) => {
    features[key] = enabled.has(key);
    return features;
  }, {});
};

const resolveTrialDaysLeft = (business, now = new Date()) => {
  if (!business.trialEnd) {
    return null;
  }

  return Math.max(0, moment(business.trialEnd).diff(moment(now), "days"));
};

const resolveSubscriptionAccess = (business, now = new Date()) => {
  const status = business.subscriptionStatus || "none";
  const daysLeft = status === "trialing" ? resolveTrialDaysLeft(business, now) : null;

  if (status === "active") {
    return {
      status,
      effectiveStatus: "active",
      daysLeft,
      canUseProduct: true,
      reason: "subscription_active",
    };
  }

  if (status === "trialing") {
    if (daysLeft !== null && daysLeft > 0) {
      return {
        status,
        effectiveStatus: "trialing",
        daysLeft,
        canUseProduct: true,
        reason: "trial_active",
      };
    }

    return {
      status,
      effectiveStatus: "incomplete_expired",
      daysLeft: 0,
      canUseProduct: false,
      reason: "trial_expired",
    };
  }

  return {
    status,
    effectiveStatus: status,
    daysLeft,
    canUseProduct: false,
    reason: "subscription_required",
  };
};

const resolvePlanContract = (business, canUseProduct) => {
  const snapshot = business.subscriptionPlan;

  if (snapshot?.stripePriceId) {
    return {
      source: snapshot.source || "plan_snapshot",
      planId: snapshot.planId || null,
      title: snapshot.title || "",
      stripePriceId: snapshot.stripePriceId || "",
      stripeProductId: snapshot.stripeProductId || "",
      billingInterval: snapshot.billingInterval || "",
      currency: snapshot.currency || "",
      amount: typeof snapshot.amount === "number" ? snapshot.amount : null,
      featureKeys: normalizeFeatureKeys(snapshot.featureKeys),
      limits: normalizePlanLimits(snapshot.limits),
    };
  }

  if (canUseProduct) {
    return {
      source: "legacy_full_access",
      planId: null,
      title: "Legacy full access",
      stripePriceId: "",
      stripeProductId: "",
      billingInterval: "",
      currency: "",
      amount: null,
      featureKeys: CORE_FEATURE_KEYS,
      limits: normalizePlanLimits(),
    };
  }

  return {
    source: "none",
    planId: null,
    title: "",
    stripePriceId: "",
    stripeProductId: "",
    billingInterval: "",
    currency: "",
    amount: null,
    featureKeys: [],
    limits: normalizePlanLimits(),
  };
};

const buildBusinessEntitlements = (business, { now = new Date() } = {}) => {
  const subscriptionAccess = resolveSubscriptionAccess(business, now);
  const plan = resolvePlanContract(
    business,
    subscriptionAccess.canUseProduct
  );
  const featureKeys =
    plan.featureKeys.length > 0 ? plan.featureKeys : CORE_FEATURE_KEYS;

  return {
    billingScope: PLATFORM_BILLING_SCOPE,
    subscription: {
      status: subscriptionAccess.status,
      effectiveStatus: subscriptionAccess.effectiveStatus,
      daysLeft: subscriptionAccess.daysLeft,
      trialEnd: business.trialEnd || null,
      isTrialActive:
        subscriptionAccess.effectiveStatus === "trialing" &&
        subscriptionAccess.canUseProduct,
      isSubscriptionActive: subscriptionAccess.effectiveStatus === "active",
      requiresPayment: !subscriptionAccess.canUseProduct,
    },
    access: {
      canUseProduct: subscriptionAccess.canUseProduct,
      reason: subscriptionAccess.reason,
    },
    plan,
    features: buildFeatureMap(featureKeys, subscriptionAccess.canUseProduct),
    limits: plan.limits,
  };
};

module.exports = {
  CORE_FEATURE_KEYS,
  buildBusinessEntitlements,
  resolveSubscriptionAccess,
};
