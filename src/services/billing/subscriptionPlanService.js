const Plan = require("../../models/plan");

const PLAN_LIMIT_KEYS = [
  "maxStaff",
  "maxLocations",
  "monthlyCampaignRecipients",
  "smsCreditsIncluded",
  "emailCreditsIncluded",
];

const normalizeFeatureKeys = (featureKeys = []) => {
  if (!Array.isArray(featureKeys)) {
    return [];
  }

  return [...new Set(
    featureKeys
      .map((key) => (typeof key === "string" ? key.trim().toLowerCase() : ""))
      .filter(Boolean)
  )];
};

const normalizePlanLimits = (limits = {}) =>
  PLAN_LIMIT_KEYS.reduce((normalized, key) => {
    const rawValue = limits?.[key];
    normalized[key] =
      typeof rawValue === "number" && rawValue >= 0 ? rawValue : null;
    return normalized;
  }, {});

const buildPlanSnapshot = (plan) => {
  if (!plan) {
    return null;
  }

  return {
    planId: plan._id,
    title: plan.title || "",
    stripePriceId: plan.stripePriceId || "",
    stripeProductId: plan.stripeProductId || "",
    billingInterval: plan.billingInterval || "",
    currency: plan.currency || "",
    amount: typeof plan.amount === "number" ? plan.amount : null,
    featureKeys: normalizeFeatureKeys(plan.featureKeys),
    limits: normalizePlanLimits(plan.limits),
    source: "plan_snapshot",
  };
};

const findActivePlanByPriceId = async (priceId) => {
  const normalizedPriceId =
    typeof priceId === "string" ? priceId.trim() : "";
  if (!normalizedPriceId) {
    return null;
  }

  return Plan.findOne({
    stripePriceId: normalizedPriceId,
    isActive: true,
  });
};

const resolveActivePlanSnapshotByPriceId = async (priceId) => {
  const plan = await findActivePlanByPriceId(priceId);
  return buildPlanSnapshot(plan);
};

const requireActivePlanSnapshotByPriceId = async (priceId) => {
  const snapshot = await resolveActivePlanSnapshotByPriceId(priceId);
  if (!snapshot) {
    const error = new Error("priceId must belong to an active plan");
    error.statusCode = 400;
    throw error;
  }

  return snapshot;
};

const extractSubscriptionPriceId = (subscription) =>
  subscription?.items?.data?.[0]?.price?.id ||
  subscription?.plan?.id ||
  subscription?.metadata?.planPriceId ||
  "";

module.exports = {
  PLAN_LIMIT_KEYS,
  normalizeFeatureKeys,
  normalizePlanLimits,
  buildPlanSnapshot,
  findActivePlanByPriceId,
  resolveActivePlanSnapshotByPriceId,
  requireActivePlanSnapshotByPriceId,
  extractSubscriptionPriceId,
};
