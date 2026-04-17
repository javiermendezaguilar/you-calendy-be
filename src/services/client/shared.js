const Business = require("../../models/User/business");

const buildServiceError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getOwnerUserId = (user) => user?._id || user?.id;

const findOwnedBusinessOrThrow = async (user) => {
  const business = await Business.findOne({ owner: getOwnerUserId(user) });

  if (!business) {
    throw buildServiceError("Business not found for this user.", 404);
  }

  return business;
};

module.exports = {
  buildServiceError,
  getOwnerUserId,
  findOwnedBusinessOrThrow,
};
