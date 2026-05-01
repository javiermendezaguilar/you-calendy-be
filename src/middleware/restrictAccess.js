const Business = require("../models/User/business");
const {
  buildBusinessEntitlements,
} = require("../services/billing/entitlementService");
const ErrorHandler = require("../utils/ErrorHandler");

module.exports = async (req, res, next) => {
  // You may want to skip this for public routes
  const userId = req.user && req.user.id;
  if (!userId) return ErrorHandler("Not Authenticated", 401, req, res);
  const business = await Business.findOne({ owner: userId });
  if (!business) return ErrorHandler("Business not found", 403, req, res);

  const entitlements = buildBusinessEntitlements(business);
  if (entitlements.access.canUseProduct) return next();

  return ErrorHandler("Your trial has ended. Please upgrade to continue.", 402, req, res);
};
