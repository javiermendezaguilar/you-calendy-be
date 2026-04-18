const Business = require("../../models/User/business");
const Client = require("../../models/client");
const { normalizePhone, getCountryCode } = require("../../utils/index");
const { buildServiceError, ensureObjectIdString } = require("./coreService");

const getBusinessForOwner = async (ownerId) => {
  const business = await Business.findOne({ owner: ownerId });
  if (!business) {
    throw buildServiceError("Business not found", 404);
  }

  return business;
};

const resolveBusinessClient = async (business, payload) => {
  const {
    clientId,
    firstName = "",
    lastName = "",
    phone,
    email,
    staffId,
  } = payload;

  if (clientId) {
    const validClientId = ensureObjectIdString(clientId, "Client ID is invalid");
    const client = await Client.findOne({
      _id: { $eq: validClientId },
      business: { $eq: business._id },
    });

    if (!client) {
      throw buildServiceError("Client not found", 404);
    }

    return client;
  }

  if (!phone) {
    throw buildServiceError(
      "Phone is required when clientId is not provided",
      400
    );
  }

  const countryHint = getCountryCode(business.contactInfo?.phone);
  const normalizedPhone = normalizePhone(phone, countryHint);
  const { client } = await Client.findOrCreateUnregistered(business._id, {
    firstName,
    lastName,
    phone: normalizedPhone,
    email: email || undefined,
  });

  if (staffId) {
    client.staff = ensureObjectIdString(staffId, "Staff ID is invalid");
    await client.save();
  }

  return client;
};

module.exports = {
  getBusinessForOwner,
  resolveBusinessClient,
};
