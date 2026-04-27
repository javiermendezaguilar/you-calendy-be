const Client = require("../../models/client");
const {
  findOwnedBusinessOrThrow,
  buildServiceError,
  ensureObjectIdString,
} = require("./shared");

const getClientPhonesForOwner = async (user) => {
  const business = await findOwnedBusinessOrThrow(user);
  const clients = await Client.find({ business: business._id }).select(
    "_id phone firstName lastName email consentFlags"
  );

  return {
    phones: clients.map((client) => ({
      clientId: client._id,
      phone: client.phone,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      consentFlags: client.consentFlags,
    })),
  };
};

const getClientByIdForOwner = async (user, clientId) => {
  const business = await findOwnedBusinessOrThrow(user);
  const safeClientId = ensureObjectIdString(clientId, "Invalid client ID.");
  const client = await Client.findOne({
    _id: safeClientId,
    business: business._id,
  }).populate("staff", "firstName lastName");

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  return client.toObject();
};

module.exports = {
  getClientPhonesForOwner,
  getClientByIdForOwner,
};
