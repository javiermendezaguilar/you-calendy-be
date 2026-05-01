const Business = require("../models/User/business");
const DomainEvent = require("../models/domainEvent");
const crypto = require("crypto");

const ALLOWED_EVENT_TYPES = new Set([
  "booking_created",
  "booking_modified",
  "booking_cancelled",
  "walkin_created",
  "walkin_converted",
  "walkin_lost",
  "client_checked_in",
  "service_started",
  "service_completed",
  "no_show_marked",
  "late_cancel_marked",
  "customer_blocked",
  "checkout_opened",
  "checkout_closed",
  "payment_captured",
  "payment_refunded",
  "payment_voided",
  "policy_charge_intent_created",
  "policy_charge_captured",
  "policy_charge_failed",
  "rebook_created",
  "rebooking_follow_up_needed",
  "rebooking_declined",
  "business_observability_signal",
]);

const normalizeLimit = (value) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 20;
  }

  return Math.min(parsed, 100);
};

const normalizeType = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();
  if (!ALLOWED_EVENT_TYPES.has(normalized)) {
    const error = new Error("Invalid domain event type");
    error.statusCode = 400;
    throw error;
  }

  return normalized;
};

const toStableValue = (value) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value.toHexString === "function") {
    return value.toHexString();
  }

  if (Array.isArray(value)) {
    return value.map(toStableValue);
  }

  if (typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = toStableValue(value[key]);
        return acc;
      }, {});
  }

  return value;
};

const buildPayloadHash = (payload) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(toStableValue(payload || {})))
    .digest("hex")
    .slice(0, 32);

const normalizeRequiredPart = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error(`${label} is required for domain events`);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
};

const buildIdempotencyKey = ({
  type,
  actorType,
  actorId,
  shopId,
  source,
  correlationId,
  payload,
}) =>
  [
    normalizeRequiredPart(type, "type"),
    normalizeRequiredPart(shopId, "shopId"),
    normalizeRequiredPart(source, "source"),
    normalizeRequiredPart(actorType, "actorType"),
    normalizeRequiredPart(actorId, "actorId"),
    normalizeRequiredPart(correlationId, "correlationId"),
    buildPayloadHash(payload),
  ].join(":");

const recordDomainEvent = async ({
  type,
  actorType = "user",
  actorId,
  shopId,
  source = "api",
  correlationId = "",
  occurredAt = new Date(),
  payload = {},
}) => {
  if (!type || !actorId || !shopId || !correlationId) {
    throw new Error(
      "type, actorId, shopId and correlationId are required for domain events"
    );
  }

  const idempotencyKey = buildIdempotencyKey({
    type,
    actorType,
    actorId,
    shopId,
    source,
    correlationId,
    payload,
  });
  const eventDocument = {
    type,
    actorType,
    actorId,
    shopId,
    source,
    correlationId: String(correlationId),
    occurredAt,
    recordedAt: new Date(),
    payload,
    idempotencyKey,
  };

  try {
    return await DomainEvent.findOneAndUpdate(
      { idempotencyKey },
      { $setOnInsert: eventDocument },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );
  } catch (error) {
    if (error?.code === 11000) {
      const existingEvent = await DomainEvent.findOne({ idempotencyKey });
      if (existingEvent) {
        return existingEvent;
      }
    }

    throw error;
  }
};

const getDomainEventsForOwner = async (ownerId, { type, limit } = {}) => {
  const business = await Business.findOne({ owner: ownerId });
  if (!business) {
    const error = new Error("Business not found");
    error.statusCode = 404;
    throw error;
  }

  const query = {
    shopId: { $eq: business._id },
  };

  const normalizedType = normalizeType(type);
  if (normalizedType) {
    query.type = { $eq: normalizedType };
  }

  const events = await DomainEvent.find(query)
    .sort({ occurredAt: -1, recordedAt: -1, _id: -1 })
    .limit(normalizeLimit(limit))
    .lean();

  return {
    businessId: business._id,
    total: events.length,
    events,
  };
};

module.exports = {
  recordDomainEvent,
  getDomainEventsForOwner,
};
