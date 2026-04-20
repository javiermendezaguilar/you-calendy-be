const Business = require("../models/User/business");
const ErrorHandler = require("../utils/ErrorHandler");

const getBusinessForOwner = async (ownerId) => {
  return Business.findOne({ owner: ownerId });
};

const resolveBusinessOrReply = async (req, res) => {
  const business = await getBusinessForOwner(req.user.id);
  if (!business) {
    ErrorHandler(
      "Only the business owner can access this commerce flow",
      403,
      req,
      res
    );
    return null;
  }

  return business;
};

module.exports = {
  getBusinessForOwner,
  resolveBusinessOrReply,
};
