const Business = require("../models/User/business");
const {
  buildBusinessEntitlements,
} = require("../services/billing/entitlementService");

module.exports = async (req, res, next) => {
  // You may want to skip this for public routes
  const userId = req.user && req.user.id;
  if (!userId) return res.status(401).json({ message: "Not Authenticated" });
  const business = await Business.findOne({ owner: userId });
  if (!business) return res.status(403).json({ message: "Business not found" });

  const entitlements = buildBusinessEntitlements(business);
  if (entitlements.access.canUseProduct) return next();

  return res.status(402).json({ message: "Your trial has ended. Please upgrade to continue." });
};
