const moment = require("moment");
const Appointment = require("../../models/appointment");
const Checkout = require("../../models/checkout");
const { isTerminalVisitStatus } = require("../appointment/stateService");
const { getBusinessForOwner } = require("../business/shared");

const VISIT_SOURCE = "appointment_semantic_layer";
const VISIT_STATUSES = new Set([
  "not_started",
  "checked_in",
  "in_service",
  "completed",
  "no_show",
  "cancelled",
]);
const VISIT_TYPES = new Set(["appointment", "walk_in"]);
const REAL_VISIT_STATUSES = [
  "checked_in",
  "in_service",
  "completed",
  "no_show",
  "cancelled",
];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const CHECKOUT_STATUS_PRIORITY = {
  paid: 3,
  closed: 2,
  open: 1,
};

const buildVisitReadError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeBooleanQuery = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return false;
  }

  if (value === true || value === "true" || value === "1") {
    return true;
  }

  if (value === false || value === "false" || value === "0") {
    return false;
  }

  throw buildVisitReadError(`${fieldName} must be true or false`);
};

const normalizeLimit = (value) => {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_LIMIT;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw buildVisitReadError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }

  return parsed;
};

const normalizeVisitStatus = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();
  if (!VISIT_STATUSES.has(normalized)) {
    throw buildVisitReadError("Invalid visitStatus");
  }

  return normalized;
};

const normalizeVisitType = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();
  if (!VISIT_TYPES.has(normalized)) {
    throw buildVisitReadError("Invalid visitType");
  }

  return normalized;
};

const normalizeDateFilter = (date) => {
  if (!date) {
    return null;
  }

  const parsed = moment(date, "YYYY-MM-DD", true);
  if (!parsed.isValid()) {
    throw buildVisitReadError("date must use YYYY-MM-DD format");
  }

  return {
    label: parsed.format("YYYY-MM-DD"),
    start: parsed.clone().startOf("day").toDate(),
    end: parsed.clone().endOf("day").toDate(),
  };
};

const buildVisitFilters = (businessId, normalizedQuery) => {
  const filters = {
    business: businessId,
  };

  if (normalizedQuery.visitStatus) {
    filters.visitStatus = normalizedQuery.visitStatus;
  } else if (!normalizedQuery.includePlanned) {
    filters.visitStatus = { $in: REAL_VISIT_STATUSES };
  }

  if (normalizedQuery.visitType) {
    filters.visitType = normalizedQuery.visitType;
  }

  if (normalizedQuery.date) {
    filters.date = {
      $gte: normalizedQuery.date.start,
      $lte: normalizedQuery.date.end,
    };
  }

  return filters;
};

const toId = (documentOrId) => {
  if (!documentOrId) {
    return null;
  }

  return documentOrId._id || documentOrId;
};

const buildPersonSummary = (person) => {
  if (!person) {
    return null;
  }

  return {
    _id: toId(person),
    firstName: person.firstName || "",
    lastName: person.lastName || "",
    email: person.email || "",
    phone: person.phone || "",
  };
};

const buildStaffSummary = (staff) => {
  if (!staff) {
    return null;
  }

  return {
    _id: toId(staff),
    firstName: staff.firstName || "",
    lastName: staff.lastName || "",
  };
};

const buildReservedServiceSummary = (service) => {
  if (!service) {
    return null;
  }

  return {
    _id: toId(service),
    name: service.name || "",
    price: Number(service.price) || 0,
    currency: service.currency || "",
    duration: Number(service.duration) || 0,
  };
};

const buildCheckoutSummary = (checkout) => {
  if (!checkout) {
    return null;
  }

  return {
    _id: checkout._id,
    status: checkout.status || "",
    refundStatus: checkout.refundSummary?.status || "none",
  };
};

const buildPerformedServiceSummaries = (checkout) => {
  if (!checkout?.serviceLines?.length) {
    return [];
  }

  return checkout.serviceLines.map((line) => ({
    _id: line._id || null,
    service: {
      _id: line.service?.id || null,
      name: line.service?.name || "",
    },
    staff: {
      _id: line.staff?.id || null,
      firstName: line.staff?.firstName || "",
      lastName: line.staff?.lastName || "",
    },
    quantity: Number(line.quantity) || 1,
    unitPrice: Number(line.unitPrice) || 0,
    durationMinutes: Number(line.durationMinutes) || 0,
    adjustmentAmount: Number(line.adjustmentAmount) || 0,
    lineTotal: Number(line.lineTotal) || 0,
    source: line.source || "",
    note: line.note || "",
  }));
};

const buildCheckoutReadiness = (appointment, checkout = null) => {
  const hasCompletedVisit =
    appointment.status === "Completed" && appointment.visitStatus === "completed";
  const hasExistingCheckout = Boolean(checkout);
  const canOpenCheckout = hasCompletedVisit && !hasExistingCheckout;

  let reason = "completed_visit";
  if (!hasCompletedVisit) {
    reason = "requires_completed_visit";
  } else if (checkout?.status === "open") {
    reason = "open_checkout_exists";
  } else if (hasExistingCheckout) {
    reason = "terminal_checkout_exists";
  }

  return {
    canOpenCheckout,
    reason,
    requiredLegacyStatus: "Completed",
    requiredVisitStatus: "completed",
    existingCheckout: buildCheckoutSummary(checkout),
  };
};

const buildVisitReadModel = (appointment, checkoutByAppointment = new Map()) => {
  const visitStatus = appointment.visitStatus || "not_started";
  const sourceAppointmentId = appointment._id.toString();
  const existingCheckout = checkoutByAppointment.get(sourceAppointmentId) || null;

  return {
    visitId: appointment._id,
    source: VISIT_SOURCE,
    sourceAppointmentId: appointment._id,
    businessId: appointment.business,
    visitType: appointment.visitType || "appointment",
    bookingStatus: appointment.bookingStatus || "",
    visitStatus,
    legacyStatus: appointment.status || "",
    isVisitStarted: REAL_VISIT_STATUSES.includes(visitStatus),
    isVisitTerminal: isTerminalVisitStatus(visitStatus),
    scheduled: {
      date: appointment.date ? moment(appointment.date).format("YYYY-MM-DD") : null,
      startTime: appointment.startTime || "",
      endTime: appointment.endTime || "",
      duration: Number(appointment.duration) || 0,
    },
    operationalTimestamps: {
      checkedInAt: appointment.operationalTimestamps?.checkedInAt || null,
      checkedInBy: appointment.operationalTimestamps?.checkedInBy || null,
      serviceStartedAt:
        appointment.operationalTimestamps?.serviceStartedAt || null,
      serviceStartedBy:
        appointment.operationalTimestamps?.serviceStartedBy || null,
    },
    client: buildPersonSummary(appointment.client),
    staff: buildStaffSummary(appointment.staff),
    reservedService: buildReservedServiceSummary(appointment.service),
    performedServices: buildPerformedServiceSummaries(existingCheckout),
    performedServiceSource: existingCheckout?.serviceLines?.length
      ? "checkout_service_lines"
      : "not_recorded",
    payment: {
      status: appointment.paymentStatus || "",
      sourcePrice: Number(appointment.price) || 0,
    },
    checkoutReadiness: buildCheckoutReadiness(appointment, existingCheckout),
  };
};

const normalizeVisitQuery = (query = {}) => ({
  includePlanned: normalizeBooleanQuery(query.includePlanned, "includePlanned"),
  visitStatus: normalizeVisitStatus(query.visitStatus),
  visitType: normalizeVisitType(query.visitType),
  date: normalizeDateFilter(query.date),
  limit: normalizeLimit(query.limit),
});

const getVisitsForOwner = async (ownerId, query = {}) => {
  const business = await getBusinessForOwner(ownerId);
  const normalizedQuery = normalizeVisitQuery(query);
  const filters = buildVisitFilters(business._id, normalizedQuery);

  const appointments = await Appointment.find(filters)
    .populate("client", "firstName lastName email phone")
    .populate("staff", "firstName lastName")
    .populate("service", "name price currency duration")
    .sort({ date: 1, startTime: 1, createdAt: 1 })
    .limit(normalizedQuery.limit)
    .lean();
  const appointmentIds = appointments.map((appointment) => appointment._id);
  const checkouts = appointmentIds.length
    ? await Checkout.find({
        business: business._id,
        appointment: { $in: appointmentIds },
        status: { $in: Object.keys(CHECKOUT_STATUS_PRIORITY) },
      })
        .select("appointment status refundSummary serviceLines")
        .lean()
    : [];
  const checkoutByAppointment = checkouts.reduce((map, checkout) => {
    const appointmentId = checkout.appointment.toString();
    const current = map.get(appointmentId);
    const currentPriority = CHECKOUT_STATUS_PRIORITY[current?.status] || 0;
    const nextPriority = CHECKOUT_STATUS_PRIORITY[checkout.status] || 0;

    if (!current || nextPriority > currentPriority) {
      map.set(appointmentId, checkout);
    }

    return map;
  }, new Map());

  return {
    source: VISIT_SOURCE,
    businessId: business._id,
    filters: {
      includePlanned: normalizedQuery.includePlanned,
      visitStatus: normalizedQuery.visitStatus,
      visitType: normalizedQuery.visitType,
      date: normalizedQuery.date?.label || null,
      limit: normalizedQuery.limit,
    },
    count: appointments.length,
    visits: appointments.map((appointment) =>
      buildVisitReadModel(appointment, checkoutByAppointment)
    ),
  };
};

module.exports = {
  REAL_VISIT_STATUSES,
  VISIT_SOURCE,
  buildVisitReadModel,
  getVisitsForOwner,
};
