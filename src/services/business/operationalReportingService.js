const moment = require("moment");
const Appointment = require("../../models/appointment");
const CashSession = require("../../models/cashSession");
const Checkout = require("../../models/checkout");
const Payment = require("../../models/payment");
const Refund = require("../../models/refund");
const Staff = require("../../models/staff");
const { buildCommercePaymentFilter } = require("../payment/paymentScope");
const { buildRebookingSummary } = require("../payment/rebookingSummary");
const { COMMERCE_REPORTING_SCOPE } = require("../payment/reportingScope");
const { buildServiceError } = require("./coreService");
const { getBusinessForOwner } = require("./shared");

const RETAINED_PAYMENT_STATUSES = [
  "captured",
  "refunded_partial",
  "refunded_full",
];
const CLOSED_APPOINTMENT_STATUSES = [
  "Completed",
  "No-Show",
  "Missed",
  "Canceled",
];
const TERMINAL_WALK_IN_QUEUE_STATUSES = [
  "completed",
  "abandoned",
  "cancelled",
];
const NON_OCCUPYING_APPOINTMENT_STATUSES = ["Canceled", "No-Show", "Missed"];
const DAY_NAMES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const REPORTING_QUERY_FILTERS = ["date", "startDate", "endDate"];
const REPORTING_SORT_ORDER = {
  payments: ["capturedAt asc", "_id asc"],
  refunds: ["refundedAt asc", "_id asc"],
  appointments: ["date asc", "startTime asc", "_id asc"],
  cashSessions: ["closedAt asc", "_id asc"],
  staff: ["lastName asc", "firstName asc", "_id asc"],
  checkouts: ["openedAt asc", "_id asc"],
};
const PAYMENT_SORT = { capturedAt: 1, _id: 1 };
const REFUND_SORT = { refundedAt: 1, _id: 1 };
const APPOINTMENT_SORT = { date: 1, startTime: 1, _id: 1 };
const CASH_SESSION_SORT = { closedAt: 1, _id: 1 };
const STAFF_SORT = { lastName: 1, firstName: 1, _id: 1 };
const CHECKOUT_SORT = { openedAt: 1, _id: 1 };

const roundMetric = (value, decimals = 4) => {
  const number = Number(value) || 0;
  return Number(number.toFixed(decimals));
};

const roundMoney = (value) => roundMetric(value, 2);

const divideRate = (numerator, denominator) =>
  denominator > 0 ? roundMetric(numerator / denominator) : 0;

const parseDate = (value, fieldName) => {
  const date = value ? new Date(value) : null;
  if (date && Number.isNaN(date.getTime())) {
    return { error: `${fieldName} must be a valid date` };
  }

  return { date };
};

const buildPeriod = (query = {}) => {
  if (query.date) {
    const date = moment(query.date, "YYYY-MM-DD", true);
    if (!date.isValid()) {
      throw buildServiceError("date must use YYYY-MM-DD format", 400);
    }

    return {
      start: date.clone().startOf("day").toDate(),
      end: date.clone().endOf("day").toDate(),
    };
  }

  const parsedStart = parseDate(query.startDate, "startDate");
  if (parsedStart.error) {
    throw buildServiceError(parsedStart.error, 400);
  }

  const parsedEnd = parseDate(query.endDate, "endDate");
  if (parsedEnd.error) {
    throw buildServiceError(parsedEnd.error, 400);
  }

  const now = moment();
  const start = parsedStart.date || now.clone().startOf("day").toDate();
  const end = parsedEnd.date || now.clone().endOf("day").toDate();

  if (start > end) {
    throw buildServiceError("startDate must be before endDate", 400);
  }

  return { start, end };
};

const buildDateRangeFilter = (fieldName, period) => ({
  [fieldName]: {
    $gte: period.start,
    $lte: period.end,
  },
});

const normalizeId = (value) => {
  if (!value) {
    return null;
  }

  return String(value._id || value);
};

const parseTimeToMinutes = (value) => {
  const match = String(value || "").match(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
};

const overlapMinutes = (startA, endA, startB, endB) =>
  Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));

const normalizeShift = (shift = {}) => {
  const start = parseTimeToMinutes(shift.start);
  const end = parseTimeToMinutes(shift.end);
  if (start === null || end === null || start >= end) {
    return null;
  }

  const breaks = (shift.breaks || [])
    .map((breakPeriod) => ({
      start: parseTimeToMinutes(breakPeriod.start),
      end: parseTimeToMinutes(breakPeriod.end),
    }))
    .filter(
      (breakPeriod) =>
        breakPeriod.start !== null &&
        breakPeriod.end !== null &&
        breakPeriod.start < breakPeriod.end
    );

  return { start, end, breaks };
};

const normalizeShifts = (shifts = []) =>
  shifts.map(normalizeShift).filter(Boolean);

const getBusinessDayShifts = (business, dayName) => {
  const dayConfig = business.businessHours?.[dayName];
  if (!dayConfig || dayConfig.enabled !== false) {
    return {
      closed: false,
      shifts: normalizeShifts(dayConfig?.shifts || []),
    };
  }

  return { closed: true, shifts: [] };
};

const getStaffDayShifts = (staff, dayName) => {
  const dayConfig = (staff.workingHours || []).find(
    (workingDay) => workingDay.day === dayName
  );

  if (!dayConfig || dayConfig.enabled === false) {
    return [];
  }

  return normalizeShifts(dayConfig.shifts || []);
};

const getIntersectedShiftMinutes = (businessShifts, staffShift) => {
  const boundaries = businessShifts.length
    ? businessShifts
    : [{ start: staffShift.start, end: staffShift.end, breaks: [] }];

  return boundaries.reduce((total, businessShift) => {
    const start = Math.max(staffShift.start, businessShift.start);
    const end = Math.min(staffShift.end, businessShift.end);
    if (start >= end) {
      return total;
    }

    const breakMinutes = (staffShift.breaks || []).reduce(
      (sum, breakPeriod) =>
        sum + overlapMinutes(start, end, breakPeriod.start, breakPeriod.end),
      0
    );

    return total + Math.max(0, end - start - breakMinutes);
  }, 0);
};

const getSellableMinutesForDay = (business, staffMembers, dayName) => {
  const businessDay = getBusinessDayShifts(business, dayName);
  if (businessDay.closed) {
    return 0;
  }

  return staffMembers.reduce((total, staff) => {
    if (staff.availableForBooking === false || staff.showInCalendar === false) {
      return total;
    }

    const staffShifts = getStaffDayShifts(staff, dayName);
    const staffMinutes = staffShifts.reduce(
      (sum, shift) => sum + getIntersectedShiftMinutes(businessDay.shifts, shift),
      0
    );

    return total + staffMinutes;
  }, 0);
};

const enumeratePeriodDays = (period) => {
  const days = [];
  const cursor = moment(period.start).startOf("day");
  const end = moment(period.end).startOf("day");

  while (cursor.isSameOrBefore(end, "day")) {
    days.push(cursor.clone());
    cursor.add(1, "day");
  }

  return days;
};

const appointmentHasTerminalNoShow = (appointment) =>
  appointment.policyOutcome?.type === "no_show" ||
  appointment.status === "No-Show" ||
  appointment.status === "Missed" ||
  appointment.visitStatus === "no_show";

const appointmentHasLateCancel = (appointment) =>
  appointment.policyOutcome?.type === "late_cancel";

const appointmentIsClosedForRates = (appointment) =>
  CLOSED_APPOINTMENT_STATUSES.includes(appointment.status) ||
  ["completed", "no_show", "cancelled"].includes(appointment.visitStatus) ||
  appointmentHasLateCancel(appointment);

const appointmentOccupiesCapacity = (appointment) => {
  if (!appointment.staff) {
    return false;
  }

  if (NON_OCCUPYING_APPOINTMENT_STATUSES.includes(appointment.status)) {
    return false;
  }

  if (appointment.visitStatus === "cancelled" || appointment.visitStatus === "no_show") {
    return false;
  }

  if (appointment.bookingStatus === "cancelled") {
    return false;
  }

  if (["abandoned", "cancelled"].includes(appointment.queueStatus)) {
    return false;
  }

  return true;
};

const getAppointmentDurationMinutes = (appointment) => {
  const start = parseTimeToMinutes(appointment.startTime);
  const end = parseTimeToMinutes(appointment.endTime);

  if (start !== null && end !== null && end > start) {
    return end - start;
  }

  return Math.max(0, Number(appointment.duration) || 0);
};

const buildRevenueMetrics = ({ payments, refunds }) => {
  const retainedPayments = payments.filter((payment) =>
    RETAINED_PAYMENT_STATUSES.includes(payment.status)
  );
  const voidedPayments = payments.filter((payment) => payment.status === "voided");

  const grossCaptured = retainedPayments.reduce(
    (sum, payment) => sum + (Number(payment.amount) || 0),
    0
  );
  const refundedTotal = refunds.reduce(
    (sum, refund) => sum + (Number(refund.amount) || 0),
    0
  );
  const tipsTotal = retainedPayments.reduce(
    (sum, payment) => sum + (Number(payment.tip) || 0),
    0
  );
  const netRevenue = grossCaptured - refundedTotal;
  const retainedTransactionCount = retainedPayments.length;

  return {
    grossCaptured: roundMoney(grossCaptured),
    refundedTotal: roundMoney(refundedTotal),
    netRevenue: roundMoney(netRevenue),
    voidedTotal: roundMoney(
      voidedPayments.reduce(
        (sum, payment) => sum + (Number(payment.amount) || 0),
        0
      )
    ),
    retainedTransactionCount,
    voidedCount: voidedPayments.length,
    aov: retainedTransactionCount > 0
      ? roundMoney(netRevenue / retainedTransactionCount)
      : 0,
    tipsTotal: roundMoney(tipsTotal),
    tipsRate: divideRate(tipsTotal, grossCaptured),
  };
};

const buildAppointmentMetrics = (appointments) => {
  const businessAppointments = appointments.filter(
    (appointment) => appointment.visitType !== "walk_in"
  );
  const closedAppointments = businessAppointments.filter(appointmentIsClosedForRates);
  const noShowCount = closedAppointments.filter(appointmentHasTerminalNoShow).length;
  const lateCancelCount = closedAppointments.filter(appointmentHasLateCancel).length;

  return {
    closedAppointmentCount: closedAppointments.length,
    completedCount: closedAppointments.filter(
      (appointment) =>
        appointment.status === "Completed" || appointment.visitStatus === "completed"
    ).length,
    noShowCount,
    noShowRate: divideRate(noShowCount, closedAppointments.length),
    lateCancelCount,
    lateCancelRate: divideRate(lateCancelCount, closedAppointments.length),
  };
};

const buildWalkInMetrics = (appointments) => {
  const terminalWalkIns = appointments.filter(
    (appointment) =>
      appointment.visitType === "walk_in" &&
      TERMINAL_WALK_IN_QUEUE_STATUSES.includes(appointment.queueStatus)
  );
  const convertedCount = terminalWalkIns.filter(
    (appointment) => appointment.queueStatus === "completed"
  ).length;
  const lostCount = terminalWalkIns.filter((appointment) =>
    ["abandoned", "cancelled"].includes(appointment.queueStatus)
  ).length;

  return {
    terminalCount: terminalWalkIns.length,
    convertedCount,
    lostCount,
    conversionRate: divideRate(convertedCount, terminalWalkIns.length),
    lostRate: divideRate(lostCount, terminalWalkIns.length),
  };
};

const buildCashMetrics = (cashSessions) => {
  const varianceTotal = cashSessions.reduce(
    (sum, cashSession) => sum + (Number(cashSession.variance) || 0),
    0
  );
  const absoluteVarianceTotal = cashSessions.reduce(
    (sum, cashSession) => sum + Math.abs(Number(cashSession.variance) || 0),
    0
  );

  return {
    closedSessionCount: cashSessions.length,
    varianceTotal: roundMoney(varianceTotal),
    absoluteVarianceTotal: roundMoney(absoluteVarianceTotal),
    overCount: cashSessions.filter((cashSession) => cashSession.varianceStatus === "over").length,
    shortCount: cashSessions.filter((cashSession) => cashSession.varianceStatus === "short").length,
    exactCount: cashSessions.filter((cashSession) => cashSession.varianceStatus === "exact").length,
    closingExpectedTotal: roundMoney(
      cashSessions.reduce(
        (sum, cashSession) => sum + (Number(cashSession.closingExpected) || 0),
        0
      )
    ),
    closingDeclaredTotal: roundMoney(
      cashSessions.reduce(
        (sum, cashSession) => sum + (Number(cashSession.closingDeclared) || 0),
        0
      )
    ),
  };
};

const buildOccupancyMetrics = ({ business, staffMembers, appointments, period }) => {
  const days = enumeratePeriodDays(period);
  const sellableMinutes = days.reduce((total, day) => {
    const dayName = day.format("dddd").toLowerCase();
    if (!DAY_NAMES.includes(dayName)) {
      return total;
    }

    return total + getSellableMinutesForDay(business, staffMembers, dayName);
  }, 0);
  const occupiedMinutes = appointments
    .filter(appointmentOccupiesCapacity)
    .reduce((sum, appointment) => sum + getAppointmentDurationMinutes(appointment), 0);

  return {
    staffCount: staffMembers.filter(
      (staff) => staff.availableForBooking !== false && staff.showInCalendar !== false
    ).length,
    sellableMinutes,
    occupiedMinutes,
    occupancyRate: divideRate(occupiedMinutes, sellableMinutes),
  };
};

const findCheckoutsForPayments = async (businessId, payments) => {
  const checkoutIds = [
    ...new Set(payments.map((payment) => normalizeId(payment.checkout)).filter(Boolean)),
  ];

  if (checkoutIds.length === 0) {
    return [];
  }

  return Checkout.find({
    _id: { $in: checkoutIds },
    business: businessId,
  })
    .sort(CHECKOUT_SORT)
    .lean();
};

const buildAppliedFilters = (query = {}) => ({
  accepted: REPORTING_QUERY_FILTERS,
  date: query.date || null,
  startDate: query.startDate || null,
  endDate: query.endDate || null,
});

const getOperationalReportingForOwner = async (ownerId, query = {}) => {
  const business = await getBusinessForOwner(ownerId);
  const period = buildPeriod(query);
  const paymentFilter = {
    business: business._id,
    ...buildDateRangeFilter("capturedAt", period),
    ...buildCommercePaymentFilter(),
  };

  const [payments, refunds, appointments, cashSessions, staffMembers] =
    await Promise.all([
      Payment.find(paymentFilter).sort(PAYMENT_SORT).lean(),
      Refund.find({
        business: business._id,
        ...buildDateRangeFilter("refundedAt", period),
      })
        .sort(REFUND_SORT)
        .lean(),
      Appointment.find({
        business: business._id,
        ...buildDateRangeFilter("date", period),
      })
        .sort(APPOINTMENT_SORT)
        .lean(),
      CashSession.find({
        business: business._id,
        status: "closed",
        ...buildDateRangeFilter("closedAt", period),
      })
        .sort(CASH_SESSION_SORT)
        .lean(),
      Staff.find({ business: business._id }).sort(STAFF_SORT).lean(),
    ]);

  const checkouts = await findCheckoutsForPayments(business._id, payments);

  return {
    reportingScope: {
      version: "operational_reporting_v1",
      moneyScope: COMMERCE_REPORTING_SCOPE,
      period: {
        startDate: period.start,
        endDate: period.end,
      },
      filters: buildAppliedFilters(query),
      ordering: REPORTING_SORT_ORDER,
      sources: {
        revenue: "Payment.capturedAt + Refund.refundedAt",
        appointments: "Appointment.date + Appointment.policyOutcome",
        rebooking: "Payment.checkout + Checkout.rebooking",
        cashVariance: "CashSession.closedAt",
        walkIns: "Appointment.visitType + Appointment.queueStatus",
        occupancy: "Staff.workingHours + Business.businessHours + Appointment.duration",
      },
      excludes: [
        "platform_billing",
        "Appointment.price as realized revenue",
        "voided payments from retained transactions",
        "cancelled/no-show appointments from occupied minutes",
      ],
    },
    revenue: buildRevenueMetrics({ payments, refunds }),
    appointments: buildAppointmentMetrics(appointments),
    rebooking: buildRebookingSummary(checkouts, payments),
    cash: buildCashMetrics(cashSessions),
    walkIns: buildWalkInMetrics(appointments),
    occupancy: buildOccupancyMetrics({
      business,
      staffMembers,
      appointments,
      period,
    }),
  };
};

module.exports = {
  getOperationalReportingForOwner,
};
