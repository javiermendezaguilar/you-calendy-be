const {
  recordBusinessSignal,
} = require("./businessObservabilityService");

const BUSINESS_OPERATIONAL_ALERTS = Object.freeze({
  duplicate_credit_guard: Object.freeze({
    category: "credits",
    risk: "double_credit",
    defaultSeverity: "warning",
    defaultSource: "business_operational_alerts",
    defaultAction: "duplicate_prevented",
    defaultReason: "duplicate_credit_guard",
    defaultEntityType: "payment",
  }),
  refund_anomaly: Object.freeze({
    category: "payments",
    risk: "suspicious_refund",
    defaultSeverity: "warning",
    defaultSource: "business_operational_alerts",
    defaultAction: "refund_blocked",
    defaultReason: "refund_anomaly",
    defaultEntityType: "refund",
  }),
  overbooking_guard_triggered: Object.freeze({
    category: "appointments",
    risk: "overbooking",
    defaultSeverity: "warning",
    defaultSource: "business_operational_alerts",
    defaultAction: "capacity_conflict_blocked",
    defaultReason: "capacity_conflict",
    defaultEntityType: "appointment",
  }),
  reminder_delivery_anomaly: Object.freeze({
    category: "reminders",
    risk: "duplicate_or_lost_reminder",
    defaultSeverity: "warning",
    defaultSource: "business_operational_alerts",
    defaultAction: "reminder_not_delivered",
    defaultReason: "reminder_delivery_anomaly",
    defaultEntityType: "appointment",
  }),
  cash_session_variance: Object.freeze({
    category: "cash",
    risk: "cash_variance",
    defaultSeverity: "warning",
    defaultSource: "business_operational_alerts",
    defaultAction: "cash_variance_recorded",
    defaultReason: "cash_session_variance",
    defaultEntityType: "cash_session",
  }),
  permission_boundary_violation: Object.freeze({
    category: "permissions",
    risk: "permission_leak",
    defaultSeverity: "warning",
    defaultSource: "business_operational_alerts",
    defaultAction: "access_denied",
    defaultReason: "permission_boundary_violation",
    defaultEntityType: "access_boundary",
  }),
  webhook_processing_anomaly: Object.freeze({
    category: "webhooks",
    risk: "webhook_failed",
    defaultSeverity: "error",
    defaultSource: "business_operational_alerts",
    defaultAction: "webhook_failed",
    defaultReason: "webhook_processing_anomaly",
    defaultEntityType: "webhook_event",
  }),
});

const REQUIRED_BUSINESS_OPERATIONAL_ALERT_TYPES = Object.freeze(
  Object.keys(BUSINESS_OPERATIONAL_ALERTS)
);

const getBusinessOperationalAlertDefinition = (alertType) =>
  BUSINESS_OPERATIONAL_ALERTS[alertType] || null;

const listBusinessOperationalAlertDefinitions = () =>
  REQUIRED_BUSINESS_OPERATIONAL_ALERT_TYPES.map((alertType) => ({
    alertType,
    ...BUSINESS_OPERATIONAL_ALERTS[alertType],
  }));

const recordBusinessOperationalAlert = async (
  alertType,
  {
    severity,
    businessId = null,
    actorId = null,
    actorType = "system",
    source,
    correlationId = null,
    entityType,
    entityId = "",
    action,
    reason,
    metadata = {},
    captureInSentry = undefined,
  } = {}
) => {
  const definition = getBusinessOperationalAlertDefinition(alertType);
  if (!definition) {
    throw new Error(`Unknown business operational alert: ${alertType}`);
  }

  try {
    return await recordBusinessSignal({
      signalType: alertType,
      severity: severity || definition.defaultSeverity,
      businessId,
      actorId,
      actorType,
      source: source || definition.defaultSource,
      correlationId,
      entityType: entityType || definition.defaultEntityType,
      entityId,
      action: action || definition.defaultAction,
      reason: reason || definition.defaultReason,
      metadata: {
        alertCategory: definition.category,
        risk: definition.risk,
        ...metadata,
      },
      captureInSentry,
    });
  } catch (error) {
    return {
      loggerRecorded: false,
      sentryCaptured: false,
      domainEventRecorded: false,
      domainEventReason: "alert_record_failed",
      correlationId,
      errorMessage: error.message,
    };
  }
};

module.exports = {
  BUSINESS_OPERATIONAL_ALERTS,
  REQUIRED_BUSINESS_OPERATIONAL_ALERT_TYPES,
  getBusinessOperationalAlertDefinition,
  listBusinessOperationalAlertDefinitions,
  recordBusinessOperationalAlert,
};
