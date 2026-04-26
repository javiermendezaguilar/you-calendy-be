const LEGACY_FINAL_APPOINTMENT_STATUSES = new Set([
  "Canceled",
  "Completed",
  "No-Show",
  "Missed",
]);

const TERMINAL_BOOKING_STATUSES = new Set(["cancelled"]);
const TERMINAL_VISIT_STATUSES = new Set([
  "completed",
  "no_show",
  "cancelled",
]);

const getSemanticStateFromLegacyStatus = (status, overrides = {}) => {
  const semanticState = {
    bookingStatus: "booked",
    visitStatus: "not_started",
    ...overrides,
  };

  switch (status) {
    case "Confirmed":
      semanticState.bookingStatus = "confirmed";
      semanticState.visitStatus = "not_started";
      break;
    case "Canceled":
      semanticState.bookingStatus = "cancelled";
      semanticState.visitStatus = "cancelled";
      break;
    case "Completed":
      semanticState.bookingStatus = "confirmed";
      semanticState.visitStatus = "completed";
      break;
    case "No-Show":
    case "Missed":
      semanticState.bookingStatus = "confirmed";
      semanticState.visitStatus = "no_show";
      break;
    case "Pending":
    default:
      semanticState.bookingStatus = semanticState.bookingStatus || "booked";
      semanticState.visitStatus = semanticState.visitStatus || "not_started";
      break;
  }

  return semanticState;
};

const isLegacyFinalAppointmentStatus = (status) =>
  LEGACY_FINAL_APPOINTMENT_STATUSES.has(status);

const isTerminalBookingStatus = (bookingStatus) =>
  TERMINAL_BOOKING_STATUSES.has(bookingStatus);

const isTerminalVisitStatus = (visitStatus) =>
  TERMINAL_VISIT_STATUSES.has(visitStatus);

const getAppointmentTerminalReason = (appointment) => {
  if (!appointment) {
    return null;
  }

  if (isTerminalVisitStatus(appointment.visitStatus)) {
    return `visit:${appointment.visitStatus}`;
  }

  if (isTerminalBookingStatus(appointment.bookingStatus)) {
    return `booking:${appointment.bookingStatus}`;
  }

  if (isLegacyFinalAppointmentStatus(appointment.status)) {
    return `legacy:${appointment.status}`;
  }

  return null;
};

const isTerminalAppointmentState = (appointment) =>
  Boolean(getAppointmentTerminalReason(appointment));

module.exports = {
  getSemanticStateFromLegacyStatus,
  getAppointmentTerminalReason,
  isLegacyFinalAppointmentStatus,
  isTerminalAppointmentState,
  isTerminalBookingStatus,
  isTerminalVisitStatus,
};
