const moment = require("moment");
const Appointment = require("../../models/appointment");
const Staff = require("../../models/staff");
const { ensureObjectIdString } = require("../business/coreService");
const {
  buildCapacityError: buildAvailabilityError,
  NON_BLOCKING_CAPACITY_STATUSES,
  normalizeCapacityDate,
} = require("./capacityGuard");

const DEFAULT_SERVICE_DURATION_MINUTES = 60;
const DEFAULT_SLOT_INTERVAL_MINUTES = 15;

const toIdString = (value) => {
  if (!value) return null;
  return String(value._id || value);
};

const toFinitePositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseTimeToMinutes = (value) => {
  const match = String(value || "").match(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
};

const formatMinutesAsTime = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

const rangesOverlap = (startA, endA, startB, endB) =>
  startA < endB && endA > startB;

const normalizeBreaks = (breaks = []) =>
  breaks
    .map((breakPeriod) => ({
      start: parseTimeToMinutes(breakPeriod.start),
      end: parseTimeToMinutes(breakPeriod.end),
    }))
    .filter((breakPeriod) => breakPeriod.start !== null && breakPeriod.end !== null)
    .filter((breakPeriod) => breakPeriod.start < breakPeriod.end);

const normalizeShifts = (shifts = []) =>
  shifts
    .map((shift) => ({
      start: parseTimeToMinutes(shift.start),
      end: parseTimeToMinutes(shift.end),
      breaks: normalizeBreaks(shift.breaks || []),
    }))
    .filter((shift) => shift.start !== null && shift.end !== null)
    .filter((shift) => shift.start < shift.end);

const getBusinessDayConstraint = (business, dayName) => {
  const dayConfig = business.businessHours?.[dayName];
  if (!dayConfig) {
    return { closed: false, shifts: null };
  }

  if (dayConfig.enabled === false) {
    return { closed: true, shifts: [] };
  }

  const shifts = normalizeShifts(dayConfig.shifts || []);
  return {
    closed: false,
    shifts: shifts.length > 0 ? shifts : null,
  };
};

const getStaffDayShifts = (staff, dayName) => {
  if (!staff || staff.availableForBooking === false) {
    return [];
  }

  const daySchedule = (staff.workingHours || []).find(
    (workingDay) => workingDay.day === dayName
  );

  if (!daySchedule || daySchedule.enabled === false) {
    return [];
  }

  return normalizeShifts(daySchedule.shifts || []);
};

const intersectBusinessAndStaffShifts = (businessConstraint, staffShifts) => {
  if (businessConstraint.closed) {
    return [];
  }

  if (!businessConstraint.shifts) {
    return staffShifts;
  }

  const intersections = [];

  staffShifts.forEach((staffShift) => {
    businessConstraint.shifts.forEach((businessShift) => {
      const start = Math.max(staffShift.start, businessShift.start);
      const end = Math.min(staffShift.end, businessShift.end);

      if (start < end) {
        intersections.push({
          start,
          end,
          breaks: staffShift.breaks,
        });
      }
    });
  });

  return intersections;
};

const isServiceAssignedToStaff = (staff, serviceId) =>
  Boolean(
    (staff.services || []).find(
      (serviceItem) => toIdString(serviceItem.service) === toIdString(serviceId)
    )
  );

const getStaffServiceConfig = (staff, serviceId) =>
  (staff.services || []).find(
    (serviceItem) => toIdString(serviceItem.service) === toIdString(serviceId)
  );

const getServiceDurationForStaff = (service, staff, serviceId) => {
  const staffServiceConfig = getStaffServiceConfig(staff, serviceId);
  return toFinitePositiveNumber(
    staffServiceConfig?.timeInterval,
    toFinitePositiveNumber(
      service?.duration,
      DEFAULT_SERVICE_DURATION_MINUTES
    )
  );
};

const getSlotIntervalForStaff = (duration) =>
  toFinitePositiveNumber(duration, DEFAULT_SLOT_INTERVAL_MINUTES);

const slotOverlapsBreak = (shift, slotStart, slotEnd) =>
  (shift.breaks || []).some((breakPeriod) =>
    rangesOverlap(slotStart, slotEnd, breakPeriod.start, breakPeriod.end)
  );

const buildCandidateSlots = (shifts, duration) => {
  const slotInterval = getSlotIntervalForStaff(duration);
  const slots = [];

  shifts.forEach((shift) => {
    for (
      let slotStart = shift.start;
      slotStart + duration <= shift.end;
      slotStart += slotInterval
    ) {
      const slotEnd = slotStart + duration;

      if (!slotOverlapsBreak(shift, slotStart, slotEnd)) {
        slots.push({
          start: slotStart,
          end: slotEnd,
          time: formatMinutesAsTime(slotStart),
        });
      }
    }
  });

  return slots;
};

const appointmentBlocksStaffSlot = (appointment, staffId, slotStart, slotEnd) => {
  const appointmentStaffId = toIdString(appointment.staff);
  if (appointmentStaffId && appointmentStaffId !== toIdString(staffId)) {
    return false;
  }

  const appointmentStart = parseTimeToMinutes(appointment.startTime);
  const appointmentEnd = parseTimeToMinutes(appointment.endTime);

  if (appointmentStart === null || appointmentEnd === null) {
    return false;
  }

  return rangesOverlap(slotStart, slotEnd, appointmentStart, appointmentEnd);
};

const parseTimezoneOffset = (timezoneOffset) => {
  if (timezoneOffset === undefined || timezoneOffset === null || timezoneOffset === "") {
    return null;
  }

  const raw = String(timezoneOffset).trim();
  if (raw.includes(":")) {
    const [hours, minutes] = raw.replace(/[+-]/, "").split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return null;
    }
    const sign = raw.startsWith("-") ? -1 : 1;
    return sign * (hours * 60 + minutes);
  }

  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const applyTimeFilters = ({
  slots,
  date,
  timezoneOffset,
  bookingBuffer,
}) => {
  const parsedOffset = parseTimezoneOffset(timezoneOffset);
  const currentTime =
    parsedOffset !== null ? moment.utc().utcOffset(parsedOffset) : moment();
  const requestedDateMoment =
    parsedOffset !== null
      ? moment.utc(date).utcOffset(parsedOffset)
      : moment(date);
  const isToday = requestedDateMoment.isSame(currentTime, "day");
  const effectiveBuffer = toFinitePositiveNumber(bookingBuffer, 0);

  return slots.filter((slot) => {
    const slotDateTime = requestedDateMoment.clone().set({
      hour: Math.floor(slot.start / 60),
      minute: slot.start % 60,
      second: 0,
      millisecond: 0,
    });

    if (!slotDateTime.isAfter(currentTime)) {
      return false;
    }

    if (effectiveBuffer > 0 && isToday) {
      return slotDateTime.diff(currentTime, "minutes") >= effectiveBuffer;
    }

    return true;
  });
};

const computeStaffAvailability = ({
  business,
  service,
  serviceId,
  staff,
  date,
  dayName,
  appointments,
  businessConstraint,
  timezoneOffset,
  useBusinessBuffer,
}) => {
  if (!isServiceAssignedToStaff(staff, serviceId)) {
    return null;
  }

  const staffShifts = getStaffDayShifts(staff, dayName);
  const effectiveShifts = intersectBusinessAndStaffShifts(
    businessConstraint,
    staffShifts
  );
  const duration = getServiceDurationForStaff(service, staff, serviceId);
  const candidateSlots = buildCandidateSlots(effectiveShifts, duration);
  const availableBeforeTimeFilters = candidateSlots.filter(
    (slot) =>
      !appointments.some((appointment) =>
        appointmentBlocksStaffSlot(appointment, staff._id, slot.start, slot.end)
      )
  );
  const bookingBuffer = useBusinessBuffer
    ? business.bookingBuffer
    : staff.bookingBuffer;
  const filteredSlots = applyTimeFilters({
    slots: availableBeforeTimeFilters,
    date,
    timezoneOffset,
    bookingBuffer,
  });

  return {
    staff: {
      _id: staff._id,
      firstName: staff.firstName,
      lastName: staff.lastName,
    },
    duration,
    availableSlots: filteredSlots.map((slot) => slot.time),
  };
};

const buildAppointmentDayQuery = (businessId, date) => {
  const dayStart = normalizeCapacityDate(date);
  const dayEnd = moment(dayStart).endOf("day").toDate();

  return {
    business: businessId,
    date: { $gte: dayStart, $lte: dayEnd },
    status: { $nin: NON_BLOCKING_CAPACITY_STATUSES },
  };
};

const getAvailabilityForBusiness = async ({
  business,
  service,
  serviceId,
  staffId = null,
  date,
  timezoneOffset = null,
}) => {
  const requestedDate = moment(date, ["YYYY-MM-DD", moment.ISO_8601], true);
  if (!requestedDate.isValid()) {
    throw buildAvailabilityError("Invalid date format. Use YYYY-MM-DD", 400);
  }

  const dayName = requestedDate.format("dddd").toLowerCase();
  const businessConstraint = getBusinessDayConstraint(business, dayName);
  const validServiceId = ensureObjectIdString(
    String(serviceId || ""),
    "Service ID is invalid"
  );
  const appointments = await Appointment.find(
    buildAppointmentDayQuery(business._id, date)
  ).lean();

  if (staffId) {
    const validStaffId = ensureObjectIdString(
      String(staffId || ""),
      "Staff ID is invalid"
    );
    const staff = await Staff.findOne({
      _id: { $eq: validStaffId },
      business: { $eq: business._id },
    });

    if (!staff || staff.availableForBooking === false) {
      return { availableSlots: [], availabilityByStaff: [] };
    }

    if (!isServiceAssignedToStaff(staff, serviceId)) {
      throw buildAvailabilityError(
        "Selected service is not assigned to the specified staff member",
        400
      );
    }

    const availability = computeStaffAvailability({
      business,
      service,
      serviceId: validServiceId,
      staff,
      date,
      dayName,
      appointments,
      businessConstraint,
      timezoneOffset,
      useBusinessBuffer: false,
    });

    return {
      availableSlots: availability?.availableSlots || [],
      availabilityByStaff: availability ? [availability] : [],
    };
  }

  const assignedStaff = await Staff.find({
    business: { $eq: business._id },
    services: { $elemMatch: { service: { $eq: validServiceId } } },
  });

  if (assignedStaff.length === 0) {
    throw buildAvailabilityError(
      "This service is not assigned to any staff till now",
      400
    );
  }

  const availabilityByStaff = assignedStaff
    .filter((staff) => staff.availableForBooking !== false)
    .map((staff) =>
      computeStaffAvailability({
        business,
        service,
        serviceId: validServiceId,
        staff,
        date,
        dayName,
        appointments,
        businessConstraint,
        timezoneOffset,
        useBusinessBuffer: true,
      })
    )
    .filter(Boolean);

  const availableSlotSet = new Set();
  availabilityByStaff.forEach((entry) => {
    entry.availableSlots.forEach((slot) => availableSlotSet.add(slot));
  });

  const availableSlots = Array.from(availableSlotSet).sort(
    (a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b)
  );

  return {
    availableSlots,
    availabilityByStaff,
  };
};

module.exports = {
  getAvailabilityForBusiness,
};
