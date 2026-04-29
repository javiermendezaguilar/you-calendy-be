const {
  appointmentStartTime,
  clientIdParams,
  dateOnly,
  idParams,
  objectId,
  optionalBoolean,
  optionalIntegerMin,
  optionalIntegerRange,
  optionalObjectId,
  optionalPositiveMoney,
  optionalString,
  penaltyIdParams,
  positiveMoney,
  requiredString,
  timeOnly,
  timezoneOffset,
  z,
} = require("./requestSchemaPrimitives");

const APPOINTMENT_STATUSES = [
  "Pending",
  "Confirmed",
  "Canceled",
  "Completed",
  "No-Show",
  "Missed",
];

const REMINDER_TIMES = [
  "1_hour_before",
  "2_hours_before",
  "3_hours_before",
  "4_hours_before",
];

const POLICY_CHARGE_TYPES = ["deposit", "no_show_fee", "late_cancel_fee"];

const appointmentStatus = z.enum(APPOINTMENT_STATUSES);
const reminderTime = z.enum(REMINDER_TIMES);
const policyChargeType = z.enum(POLICY_CHARGE_TYPES);

const staffFilter = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string" && value.trim() === "") return undefined;
    return typeof value === "string" ? value.trim() : value;
  },
  z.union([objectId, z.literal("all")]).optional()
);

const nullableReminderTime = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (typeof value === "string" && value.trim() === "") return undefined;
    return value;
  },
  reminderTime.nullable().optional()
);

const paginationQuery = {
  page: optionalIntegerMin(1),
  limit: optionalIntegerRange(1, 200),
};

const availableSlotsQuery = z
  .object({
    businessId: objectId,
    serviceId: objectId,
    date: dateOnly,
    staffId: optionalObjectId,
    clientId: optionalObjectId,
    timezoneOffset,
  })
  .passthrough();

const createAppointmentBody = z
  .object({
    businessId: objectId,
    clientId: optionalObjectId,
    serviceId: objectId,
    staffId: optionalObjectId,
    date: dateOnly,
    startTime: appointmentStartTime,
    duration: optionalIntegerRange(1, 1440),
    notes: optionalString(2000),
    clientNotes: optionalString(2000),
  })
  .passthrough();

const createAppointmentByBarberBody = z
  .object({
    clientId: objectId,
    serviceId: objectId,
    staffId: objectId,
    date: dateOnly,
    startTime: timeOnly,
    price: positiveMoney,
    notes: optionalString(2000),
    clientNotes: optionalString(2000),
  })
  .passthrough();

const listAppointmentsQuery = z
  .object({
    status: optionalString(80),
    date: dateOnly.optional(),
    staffId: staffFilter,
    ...paginationQuery,
  })
  .passthrough();

const appointmentHistoryQuery = z
  .object({
    status: optionalString(80),
    duration: optionalIntegerRange(1, 1440),
    date: dateOnly.optional(),
    search: optionalString(120),
    sort: optionalString(80),
    ...paginationQuery,
  })
  .passthrough();

const dashboardStatsQuery = z
  .object({
    month: optionalIntegerRange(1, 12),
    year: optionalIntegerRange(2000, 3000),
    staffId: optionalObjectId,
  })
  .passthrough();

const revenueProjectionQuery = z
  .object({
    startDate: dateOnly.optional(),
    endDate: dateOnly.optional(),
    groupBy: z.enum(["year", "day", "week", "month"]).optional(),
    staffId: optionalObjectId,
  })
  .passthrough();

const automatedReminderBody = z
  .object({
    reminderTime: reminderTime.optional(),
    appointmentReminder: optionalBoolean,
  })
  .passthrough();

const reminderSettingsBody = z
  .object({
    reminderTime: nullableReminderTime,
    appointmentReminder: optionalBoolean,
    messageReminder: optionalString(500),
  })
  .passthrough();

const reviewLinkBody = z
  .object({
    clientId: objectId,
    message: optionalString(1000),
  })
  .passthrough();

const updateAppointmentBody = z
  .object({
    date: dateOnly.optional(),
    startTime: timeOnly.optional(),
    serviceId: optionalObjectId,
    notes: optionalString(2000),
    clientNotes: optionalString(2000),
  })
  .passthrough();

const updateAppointmentStatusBody = z
  .object({
    status: appointmentStatus,
    waiveFee: optionalBoolean,
    blockClient: optionalBoolean,
    incidentNote: optionalString(1000),
    comment: optionalString(1000),
    reviewRequest: optionalBoolean,
    reviewMessage: optionalString(1000),
  })
  .passthrough();

const delayBody = z
  .object({
    newDate: dateOnly,
    newStartTime: timeOnly,
    message: requiredString(500),
  })
  .passthrough();

const penaltyBody = z
  .object({
    amount: positiveMoney,
    type: z.enum(["money"]).optional(),
    time: optionalIntegerRange(1, 10080),
    comment: optionalString(1000),
  })
  .passthrough();

const payPenaltyBody = z
  .object({
    clientId: objectId,
    appointmentId: objectId,
  })
  .passthrough();

const policyChargeBody = z
  .object({
    type: policyChargeType,
    amount: optionalPositiveMoney,
    saveCardOnFile: optionalBoolean,
    idempotencyKey: optionalString(128),
  })
  .passthrough();

module.exports = {
  appointmentInputSchemas: {
    availableSlots: {
      query: availableSlotsQuery,
    },
    createAppointment: {
      body: createAppointmentBody,
    },
    createAppointmentByBarber: {
      body: createAppointmentByBarberBody,
    },
    listAppointments: {
      query: listAppointmentsQuery,
    },
    appointmentHistory: {
      query: appointmentHistoryQuery,
    },
    dashboardStats: {
      query: dashboardStatsQuery,
    },
    revenueProjection: {
      query: revenueProjectionQuery,
    },
    automatedReminder: {
      body: automatedReminderBody,
    },
    bulkReminderSettings: {
      body: reminderSettingsBody,
    },
    updateReminderSettings: {
      params: idParams,
      body: reminderSettingsBody,
    },
    reviewLink: {
      body: reviewLinkBody,
    },
    appointmentById: {
      params: idParams,
    },
    updateAppointment: {
      params: idParams,
      body: updateAppointmentBody,
    },
    updateStatus: {
      params: idParams,
      body: updateAppointmentStatusBody,
    },
    checkIn: {
      params: idParams,
    },
    startService: {
      params: idParams,
    },
    applyPenalty: {
      params: idParams,
      body: penaltyBody,
    },
    clientPenalties: {
      params: clientIdParams,
    },
    payPenalty: {
      params: penaltyIdParams,
      body: payPenaltyBody,
    },
    delay: {
      params: idParams,
      body: delayBody,
    },
    delayInfo: {
      params: idParams,
    },
    createPolicyCharge: {
      params: idParams,
      body: policyChargeBody,
    },
    listPolicyCharges: {
      params: idParams,
    },
  },
};
