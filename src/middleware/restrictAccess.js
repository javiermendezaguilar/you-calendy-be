const Business = require("../models/User/business");
const moment = require("moment");

module.exports = async (req, res, next) => {
  // You may want to skip this for public routes
  const userId = req.user && req.user.id;
  if (!userId) return res.status(401).json({ message: "Not Authenticated" });
  const business = await Business.findOne({ owner: userId });
  if (!business) return res.status(403).json({ message: "Business not found" });
  // Allow if active subscription
  if (business.subscriptionStatus === "active") return next();
  // Allow if trialing and trial not expired
  if (business.subscriptionStatus === "trialing" && business.trialEnd && moment(business.trialEnd).isAfter(moment())) return next();
  // Otherwise, block
  return res.status(402).json({ message: "Your trial has ended. Please upgrade to continue." });
};