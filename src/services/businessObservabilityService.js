const mongoose = require("mongoose");
const Sentry = require("../instrument");
const logger = require("../functions/logger");
const Business = require("../models/User/business");
const { recordDomainEvent } = require("./domainEventService");

const BUSINESS_OBSERVABILITY_EVENT_TYPE = "business_observability_signal";
const DEFAULT_SOURCE = "business_observability";
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 20;
const MAX_DEPTH = 4;
const REDACTED_VALUE = "[redacted]";

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|password|secret|token|api[_-]?key|client[_-]?secret|rawbody|card/i;

const severityLevels = new Set(["info", "warning", "error", "critical"]);
const sentryLevels = {
  info: "info",
  warning: "warning",
  error: "error",
  critical: "fatal",
};

const normalizeString = (value) => String(value || "").trim();

const normalizeOptionalString = (value) => {
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeSeverity = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "warn") {
    return "warning";
  }

  return severityLevels.has(normalized) ? normalized : "info";
};

const toSafeString = (value) => {
  const stringValue = String(value);
  if (stringValue.length <= MAX_STRING_LENGTH) {
    return stringValue;
  }

  return `${stringValue.slice(0, MAX_STRING_LENGTH)}...`;
};

const isObjectIdLike = (value) => {
  if (!value) {
    return false;
  }

  return mongoose.Types.ObjectId.isValid(String(value));
};

const sanitizeForObservability = (value, key = "", depth = 0) => {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED_VALUE;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value?.toHexString === "function") {
    return value.toHexString();
  }

  if (typeof value === "string") {
    return toSafeString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return "[max_depth]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeForObservability(item, key, depth + 1));
  }

  if (typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, childKey) => {
        acc[childKey] = sanitizeForObservability(
          value[childKey],
          childKey,
          depth + 1
        );
        return acc;
      }, {});
  }

  return toSafeString(value);
};

const buildUniqueCorrelationId = ({ signalType, businessId, entityType }) =>
  [
    "business-signal",
    normalizeString(signalType) || "unknown",
    businessId ? String(businessId) : "global",
    normalizeString(entityType) || "none",
    Date.now(),
    Math.random().toString(36).slice(2, 10),
  ].join(":");

const getLoggerMethod = (severity) => {
  if (severity === "critical" || severity === "error") {
    return "error";
  }

  if (severity === "warning") {
    return "warn";
  }

  return "info";
};

const shouldCaptureInSentry = (severity, captureInSentry) => {
  if (typeof captureInSentry === "boolean") {
    return captureInSentry;
  }

  return severity === "warning" || severity === "error" || severity === "critical";
};

const resolveActorId = async ({ actorId, businessId }) => {
  if (isObjectIdLike(actorId)) {
    return actorId;
  }

  if (!isObjectIdLike(businessId)) {
    return null;
  }

  const business = await Business.findById(businessId).select("owner").lean();
  return business?.owner || null;
};

const logSignal = (logPayload, severity) => {
  try {
    const method = getLoggerMethod(severity);
    logger[method](logPayload);
    return true;
  } catch (error) {
    return false;
  }
};

const captureSignalInSentry = ({
  signalType,
  severity,
  businessId,
  action,
  reason,
  source,
  correlationId,
  sanitizedMetadata,
}) => {
  try {
    if (typeof Sentry.captureMessage !== "function") {
      return false;
    }

    Sentry.captureMessage(`Business signal: ${signalType}`, {
      level: sentryLevels[severity] || "info",
      tags: {
        signalType,
        severity,
        source,
        action: action || "",
        reason: reason || "",
        businessId: businessId ? String(businessId) : "",
      },
      extra: {
        correlationId,
        metadata: sanitizedMetadata,
      },
    });
    return true;
  } catch (error) {
    return false;
  }
};

const recordSignalDomainEvent = async ({
  signalType,
  severity,
  businessId,
  actorId,
  actorType,
  source,
  correlationId,
  action,
  reason,
  entityType,
  entityId,
  sanitizedMetadata,
}) => {
  if (!isObjectIdLike(businessId)) {
    return { recorded: false, reason: "business_id_missing" };
  }

  const resolvedActorId = await resolveActorId({ actorId, businessId });
  if (!isObjectIdLike(resolvedActorId)) {
    return { recorded: false, reason: "actor_not_resolved" };
  }

  const event = await recordDomainEvent({
    type: BUSINESS_OBSERVABILITY_EVENT_TYPE,
    actorType: actorType || "system",
    actorId: resolvedActorId,
    shopId: businessId,
    source,
    correlationId,
    payload: {
      signalType,
      severity,
      action: action || "",
      reason: reason || "",
      entityType: entityType || "",
      entityId: entityId ? String(entityId) : "",
      metadata: sanitizedMetadata,
    },
  });

  return {
    recorded: true,
    event,
  };
};

const recordBusinessSignal = async ({
  signalType,
  severity = "info",
  businessId = null,
  actorId = null,
  actorType = "system",
  source = DEFAULT_SOURCE,
  correlationId = null,
  entityType = "",
  entityId = "",
  action = "",
  reason = "",
  metadata = {},
  captureInSentry = undefined,
} = {}) => {
  const normalizedSignalType = normalizeString(signalType);
  if (!normalizedSignalType) {
    throw new Error("signalType is required for business observability");
  }

  const normalizedSeverity = normalizeSeverity(severity);
  const normalizedSource = normalizeString(source) || DEFAULT_SOURCE;
  const normalizedAction = normalizeOptionalString(action);
  const normalizedReason = normalizeOptionalString(reason);
  const normalizedCorrelationId =
    normalizeOptionalString(correlationId) ||
    buildUniqueCorrelationId({
      signalType: normalizedSignalType,
      businessId,
      entityType,
    });
  const sanitizedMetadata = sanitizeForObservability(metadata);
  const logPayload = {
    message: "Business observability signal",
    signalType: normalizedSignalType,
    severity: normalizedSeverity,
    businessId: businessId ? String(businessId) : null,
    actorType,
    actorId: actorId ? String(actorId) : null,
    source: normalizedSource,
    correlationId: normalizedCorrelationId,
    entityType: entityType || "",
    entityId: entityId ? String(entityId) : "",
    action: normalizedAction,
    reason: normalizedReason,
    metadata: sanitizedMetadata,
  };

  const loggerRecorded = logSignal(logPayload, normalizedSeverity);
  const sentryCaptured = shouldCaptureInSentry(
    normalizedSeverity,
    captureInSentry
  )
    ? captureSignalInSentry({
        signalType: normalizedSignalType,
        severity: normalizedSeverity,
        businessId,
        action: normalizedAction,
        reason: normalizedReason,
        source: normalizedSource,
        correlationId: normalizedCorrelationId,
        sanitizedMetadata,
      })
    : false;

  try {
    const domainEventResult = await recordSignalDomainEvent({
      signalType: normalizedSignalType,
      severity: normalizedSeverity,
      businessId,
      actorId,
      actorType,
      source: normalizedSource,
      correlationId: normalizedCorrelationId,
      action: normalizedAction,
      reason: normalizedReason,
      entityType,
      entityId,
      sanitizedMetadata,
    });

    return {
      loggerRecorded,
      sentryCaptured,
      domainEventRecorded: domainEventResult.recorded,
      domainEventReason: domainEventResult.reason || null,
      correlationId: normalizedCorrelationId,
    };
  } catch (error) {
    logSignal(
      {
        message: "Business observability record failed",
        signalType: normalizedSignalType,
        businessId: businessId ? String(businessId) : null,
        source: normalizedSource,
        correlationId: normalizedCorrelationId,
        errorMessage: error.message,
      },
      "error"
    );

    if (typeof Sentry.captureException === "function") {
      try {
        Sentry.captureException(error, {
          tags: {
            signalType: normalizedSignalType,
            source: normalizedSource,
          },
          extra: {
            businessId: businessId ? String(businessId) : null,
            correlationId: normalizedCorrelationId,
          },
        });
      } catch (captureError) {
        // Observability must never break the business flow.
      }
    }

    return {
      loggerRecorded,
      sentryCaptured,
      domainEventRecorded: false,
      domainEventReason: "record_failed",
      correlationId: normalizedCorrelationId,
    };
  }
};

module.exports = {
  BUSINESS_OBSERVABILITY_EVENT_TYPE,
  sanitizeForObservability,
  recordBusinessSignal,
};
