const Client = require("../../models/client");
const { findOwnedBusinessOrThrow, buildServiceError } = require("./shared");

const getClientPhonesForOwner = async (user) => {
  const business = await findOwnedBusinessOrThrow(user);
  const clients = await Client.find({ business: business._id }).select(
    "_id phone firstName lastName email"
  );

  return {
    phones: clients.map((client) => ({
      clientId: client._id,
      phone: client.phone,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
    })),
  };
};

const getClientByIdForOwner = async (user, clientId) => {
  const business = await findOwnedBusinessOrThrow(user);
  const client = await Client.findOne({
    _id: clientId,
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
