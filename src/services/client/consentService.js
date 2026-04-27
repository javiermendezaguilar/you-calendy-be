const Client = require("../../models/client");
const {
  buildServiceError,
  findOwnedClientOrThrow,
} = require("./shared");

const CONSENT_CHANNELS = Object.freeze([
  "marketingEmail",
  "marketingSms",
  "transactionalEmail",
  "transactionalSms",
]);

const CONSENT_SOURCES = Object.freeze([
  "unknown",
  "owner_update",
  "client_profile",
  "import",
  "checkout",
  "booking",
]);

const buildConsentChannel = (overrides = {}) => ({
  granted: overrides.granted === true,
  source: CONSENT_SOURCES.includes(overrides.source)
    ? overrides.source
    : "unknown",
  updatedAt: overrides.updatedAt || null,
  grantedAt: overrides.grantedAt || null,
  revokedAt: overrides.revokedAt || null,
  updatedBy: overrides.updatedBy || null,
});

const buildConsentFlags = (flags = {}) => {
  return CONSENT_CHANNELS.reduce((acc, channel) => {
    acc[channel] = buildConsentChannel(flags[channel] || {});
    return acc;
  }, {});
};

const serializeConsentFlags = (client) => {
  const rawFlags = client?.consentFlags?.toObject?.() || client?.consentFlags || {};
  return buildConsentFlags(rawFlags);
};

const extractConsentChanges = (payload = {}) => {
  const sourcePayload = payload.consentFlags || payload;
  return CONSENT_CHANNELS.reduce((acc, channel) => {
    if (Object.prototype.hasOwnProperty.call(sourcePayload, channel)) {
      acc[channel] = sourcePayload[channel];
    }
    return acc;
  }, {});
};

const validateConsentChanges = (changes) => {
  const entries = Object.entries(changes);

  if (!entries.length) {
    throw buildServiceError("At least one consent flag is required.", 400);
  }

  entries.forEach(([channel, value]) => {
    if (!CONSENT_CHANNELS.includes(channel)) {
      throw buildServiceError(`Unsupported consent channel: ${channel}.`, 400);
    }

    if (typeof value !== "boolean") {
      throw buildServiceError(
        `Consent channel ${channel} must be a boolean value.`,
        400
      );
    }
  });
};

const resolveConsentSource = (source) => {
  if (source === undefined || source === null || source === "") {
    return "owner_update";
  }

  if (!CONSENT_SOURCES.includes(source)) {
    throw buildServiceError("Unsupported consent source.", 400);
  }

  return source;
};

const updateClientConsentForOwner = async (user, clientId, payload = {}) => {
  const { validClientId, business } = await findOwnedClientOrThrow(
    user,
    clientId
  );
  const changes = extractConsentChanges(payload);
  validateConsentChanges(changes);
  const source = resolveConsentSource(payload.source);
  const updatedBy = user?._id || user?.id || null;
  const now = new Date();

  const client = await Client.findOne({
    _id: validClientId,
    business: business._id,
  });

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  CONSENT_CHANNELS.forEach((channel) => {
    if (!Object.prototype.hasOwnProperty.call(changes, channel)) {
      return;
    }

    const granted = changes[channel];
    const current = client.consentFlags?.[channel] || {};
    const nextChannel = {
      granted,
      source,
      updatedAt: now,
      updatedBy,
      grantedAt: granted ? now : current.grantedAt || null,
      revokedAt: granted ? null : now,
    };

    client.set(`consentFlags.${channel}`, nextChannel);
  });

  await client.save();

  return {
    clientId: client._id,
    consentFlags: serializeConsentFlags(client),
    updatedAt: client.updatedAt,
  };
};

const hasConsentForChannel = (client, channel) => {
  if (!CONSENT_CHANNELS.includes(channel)) {
    return false;
  }

  return client?.consentFlags?.[channel]?.granted === true;
};

module.exports = {
  CONSENT_CHANNELS,
  CONSENT_SOURCES,
  buildConsentFlags,
  serializeConsentFlags,
  updateClientConsentForOwner,
  hasConsentForChannel,
};
