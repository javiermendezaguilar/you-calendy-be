const mongoose = require("mongoose");
const Business = require("../../models/User/business");

const buildServiceError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getOwnerUserId = (user) => user?._id || user?.id;

const ensureObjectIdString = (value, message) => {
  if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
    throw buildServiceError(message, 400);
  }

  return value;
};

const findOwnedBusinessOrThrow = async (user) => {
  const business = await Business.findOne({ owner: getOwnerUserId(user) });

  if (!business) {
    throw buildServiceError("Business not found for this user.", 404);
  }

  return business;
};

const findOwnedClientOrThrow = async (user, clientId) => {
  const validClientId = ensureObjectIdString(clientId, "Client ID is required.");
  const business = await findOwnedBusinessOrThrow(user);

  return { validClientId, business };
};

module.exports = {
  buildServiceError,
  getOwnerUserId,
  ensureObjectIdString,
  findOwnedBusinessOrThrow,
  findOwnedClientOrThrow,
};
