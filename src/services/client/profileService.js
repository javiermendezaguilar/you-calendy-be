const Client = require("../../models/client");
const {
  buildServiceError,
  ensureObjectIdString,
  findOwnedBusinessOrThrow,
} = require("./shared");

const buildNotificationPrefs = (client) => ({
  enabled:
    client.notificationsEnabled !== undefined
      ? client.notificationsEnabled
      : true,
  clientId: client._id,
  updatedAt: client.updatedAt,
});

const getClientNotificationPreferencesForOwner = async (user, clientId) => {
  const validClientId = ensureObjectIdString(clientId, "Client ID is required.");
  const business = await findOwnedBusinessOrThrow(user);

  const client = await Client.findOne({
    _id: validClientId,
    business: business._id,
  });

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  return buildNotificationPrefs(client);
};

const toggleClientNotificationsForOwner = async (user, clientId, enabled) => {
  if (typeof enabled !== "boolean") {
    throw buildServiceError("Enabled field must be a boolean value.", 400);
  }

  const validClientId = ensureObjectIdString(clientId, "Client ID is required.");
  const business = await findOwnedBusinessOrThrow(user);

  const client = await Client.findOne({
    _id: validClientId,
    business: business._id,
  });

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  client.notificationsEnabled = enabled;
  await client.save();

  return buildNotificationPrefs(client);
};

const getPublicClientProfileById = async (clientId) => {
  const validClientId = ensureObjectIdString(clientId, "Client ID is required.");
  const client = await Client.findById(validClientId)
    .select(
      "firstName lastName email profileImage staff business isProfileComplete"
    )
    .populate("staff", "_id firstName lastName email phone")
    .populate("business", "_id name businessName");

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  return client;
};

const getClientProfileById = async (clientId) => {
  const validClientId = ensureObjectIdString(clientId, "Client ID is required.");
  const client = await Client.findById(validClientId).select(
    "firstName lastName email profileImage phone preferences isProfileComplete notificationsEnabled internalNotes haircutPhotos"
  );

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  return client;
};

const getClientOwnNotificationPreferencesById = async (clientId) => {
  const validClientId = ensureObjectIdString(clientId, "Client ID is required.");
  const client = await Client.findById(validClientId);

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  return buildNotificationPrefs(client);
};

const toggleClientOwnNotificationsById = async (clientId, enabled) => {
  if (typeof enabled !== "boolean") {
    throw buildServiceError("Enabled field must be a boolean value.", 400);
  }

  const validClientId = ensureObjectIdString(clientId, "Client ID is required.");
  const client = await Client.findById(validClientId);

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  client.notificationsEnabled = enabled;
  await client.save();

  return buildNotificationPrefs(client);
};

module.exports = {
  getClientNotificationPreferencesForOwner,
  toggleClientNotificationsForOwner,
  getPublicClientProfileById,
  getClientProfileById,
  getClientOwnNotificationPreferencesById,
  toggleClientOwnNotificationsById,
};
