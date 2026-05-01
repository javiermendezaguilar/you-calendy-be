jest.mock("../instrument", () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock("../utils/creditAwareMessaging", () => ({
  sendSMSWithCredits: jest.fn(),
}));

const DomainEvent = require("../models/domainEvent");
const Appointment = require("../models/appointment");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");
const {
  BUSINESS_OBSERVABILITY_EVENT_TYPE,
} = require("../services/businessObservabilityService");
const {
  REQUIRED_BUSINESS_OPERATIONAL_ALERT_TYPES,
  listBusinessOperationalAlertDefinitions,
  recordBusinessOperationalAlert,
} = require("../services/businessOperationalAlertService");
const {
  processAppointmentReminders,
} = require("../utils/appointmentReminderProcessor");
const { sendSMSWithCredits } = require("../utils/creditAwareMessaging");
const Sentry = require("../instrument");

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

beforeEach(() => {
  jest.clearAllMocks();
  sendSMSWithCredits.mockReset();
});

const formatTime = (date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;

const prepareReminderFixture = async () => {
  const fixture = await createCommerceFixture({
    ownerName: "Reminder Alert Owner",
    ownerEmail: "reminder-alert-owner@example.com",
    businessName: "Reminder Alert Shop",
  });

  fixture.client.isActive = true;
  fixture.client.status = "activated";
  await fixture.client.save();

  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 45 * 60 * 1000);
  fixture.appointment.date = start;
  fixture.appointment.startTime = formatTime(start);
  fixture.appointment.endTime = formatTime(end);
  fixture.appointment.status = "Confirmed";
  fixture.appointment.appointmentReminder = true;
  fixture.appointment.reminderTime = "1_hour_before";
  fixture.appointment.reminderSent = false;
  fixture.appointment.messageReminder = "Reminder";
  await fixture.appointment.save();

  return fixture;
};

describe("BE-P2-14 business operational alerts", () => {
  test("defines every required v1 alert category", () => {
    const definitions = listBusinessOperationalAlertDefinitions();
    const alertTypes = definitions.map((definition) => definition.alertType);

    expect(alertTypes).toEqual(REQUIRED_BUSINESS_OPERATIONAL_ALERT_TYPES);
    expect(alertTypes).toEqual([
      "duplicate_credit_guard",
      "refund_anomaly",
      "overbooking_guard_triggered",
      "reminder_delivery_anomaly",
      "cash_session_variance",
      "permission_boundary_violation",
      "webhook_processing_anomaly",
    ]);
    expect(
      definitions.every(
        (definition) =>
          definition.category &&
          definition.risk &&
          definition.defaultSeverity &&
          definition.defaultAction
      )
    ).toBe(true);
  });

  test("records sanitized alert events without blocking the business flow", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Operational Alert Owner",
      ownerEmail: "operational-alert-owner@example.com",
      businessName: "Operational Alert Shop",
    });

    const result = await recordBusinessOperationalAlert("refund_anomaly", {
      businessId: fixture.business._id,
      actorId: fixture.owner._id,
      source: "test",
      correlationId: "refund-anomaly:test:sanitized",
      reason: "idempotency_key_reused_for_different_refund",
      entityType: "payment",
      entityId: fixture.appointment._id,
      metadata: {
        visible: "kept",
        authorization: "do-not-store",
      },
    });

    const event = await DomainEvent.findOne({
      type: BUSINESS_OBSERVABILITY_EVENT_TYPE,
      "payload.signalType": "refund_anomaly",
      shopId: fixture.business._id,
    }).lean();

    expect(result.domainEventRecorded).toBe(true);
    expect(event).toBeTruthy();
    expect(event.payload).toMatchObject({
      signalType: "refund_anomaly",
      severity: "warning",
      reason: "idempotency_key_reused_for_different_refund",
      entityType: "payment",
    });
    expect(event.payload.metadata.visible).toBe("kept");
    expect(event.payload.metadata.authorization).toBe("[redacted]");
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  test("appointment reminder job atomically marks sent reminders", async () => {
    const fixture = await prepareReminderFixture();
    sendSMSWithCredits.mockResolvedValueOnce({ success: true });

    const result = await processAppointmentReminders();
    const appointment = await Appointment.findById(fixture.appointment._id);

    expect(result).toMatchObject({
      success: true,
      totalRemindersSent: 1,
      totalBusinessesProcessed: 1,
    });
    expect(sendSMSWithCredits).toHaveBeenCalledTimes(1);
    expect(appointment.reminderSent).toBe(true);
  });

  test("appointment reminder job records delivery failures and allows retry", async () => {
    const fixture = await prepareReminderFixture();
    sendSMSWithCredits.mockResolvedValueOnce({
      success: false,
      error: "provider_failed",
    });

    const result = await processAppointmentReminders();
    const appointment = await Appointment.findById(fixture.appointment._id);
    const event = await DomainEvent.findOne({
      type: BUSINESS_OBSERVABILITY_EVENT_TYPE,
      "payload.signalType": "reminder_delivery_anomaly",
      shopId: fixture.business._id,
    }).lean();

    expect(result).toMatchObject({
      success: true,
      totalRemindersSent: 0,
    });
    expect(sendSMSWithCredits).toHaveBeenCalledTimes(1);
    expect(appointment.reminderSent).toBe(false);
    expect(event).toBeTruthy();
    expect(event.payload).toMatchObject({
      signalType: "reminder_delivery_anomaly",
      action: "delivery_failed",
      reason: "provider_returned_failure",
      entityType: "appointment",
    });
    expect(event.payload.metadata.providerMessage).toBe("provider_failed");
  });
});
