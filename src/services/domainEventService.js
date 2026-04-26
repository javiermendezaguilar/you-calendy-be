const Business = require("../models/User/business");
const DomainEvent = require("../models/domainEvent");

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
  "rebook_created",
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
  if (!type || !actorId || !shopId) {
    throw new Error("type, actorId and shopId are required for domain events");
  }

  return DomainEvent.create({
    type,
    actorType,
    actorId,
    shopId,
    source,
    correlationId: correlationId ? String(correlationId) : "",
    occurredAt,
    recordedAt: new Date(),
    payload,
  });
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
