const Business = require("../models/User/business");
const {
  buildBusinessEntitlements,
} = require("../services/billing/entitlementService");
const {
  recordBusinessOperationalAlert,
} = require("../services/businessOperationalAlertService");
const ErrorHandler = require("../utils/ErrorHandler");

module.exports = async (req, res, next) => {
  // You may want to skip this for public routes
  const userId = req.user && req.user.id;
  if (!userId) return ErrorHandler("Not Authenticated", 401, req, res);
  const business = await Business.findOne({ owner: userId });
  if (!business) {
    await recordBusinessOperationalAlert("permission_boundary_violation", {
      actorId: userId,
      actorType: "user",
      source: "restrict_access",
      correlationId: `restrict-access:${userId}:${req.method || "unknown"}:${req.originalUrl || req.url || ""}`,
      action: "access_denied",
      reason: "business_not_found_for_actor",
      entityType: "business_access",
      metadata: {
        method: req.method || "",
        path: req.originalUrl || req.url || "",
      },
    });
    return ErrorHandler("Business not found", 403, req, res);
  }

  const entitlements = buildBusinessEntitlements(business);
  if (entitlements.access.canUseProduct) return next();

  return ErrorHandler("Your trial has ended. Please upgrade to continue.", 402, req, res);
};
