const moment = require("moment");
const Business = require("../../models/User/business");
const Service = require("../../models/service");
const Staff = require("../../models/staff");
const WaitlistEntry = require("../../models/waitlistEntry");
const {
  buildServiceError,
  ensureObjectIdString,
} = require("./coreService");
const {
  getBusinessForOwner,
  resolveBusinessClient,
} = require("./shared");
const {
  getOrderedActiveWalkIns,
  normalizeQueueDate,
} = require("./queueService");
const {
  getAvailabilityForBusiness,
} = require("../appointment/availabilityService");

const VALID_SOURCES = ["manual", "walk_in_overflow", "booking_overflow"];

const waitlistPopulate = (query) =>
  query
    .populate("client", "firstName lastName email phone registrationStatus")
    .populate("service", "name price currency")
    .populate("staff", "firstName lastName");

const ensureTimeWindow = (start, end) => {
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(start) || !timeRegex.test(end)) {
    throw buildServiceError(
      "Invalid time window format. Use HH:MM format",
      400
    );
  }

  if (moment(start, "HH:mm").isSameOrAfter(moment(end, "HH:mm"))) {
    throw buildServiceError(
      "timeWindowStart must be earlier than timeWindowEnd",
      400
    );
  }
};

const resolveWaitlistScope = async (businessId, payload) => {
  const validServiceId = ensureObjectIdString(
    payload.serviceId,
    "Service ID is invalid"
  );

  const service = await Service.findOne({
    _id: { $eq: validServiceId },
    business: { $eq: businessId },
  });

  if (!service) {
    throw buildServiceError("Service not found", 404);
  }

  let validStaffId = null;
  if (payload.staffId) {
    validStaffId = ensureObjectIdString(payload.staffId, "Staff ID is invalid");
    const staff = await Staff.findOne({
      _id: { $eq: validStaffId },
      business: { $eq: businessId },
    });

    if (!staff) {
      throw buildServiceError("Staff member not found", 404);
    }

    const serviceItem = staff.services.find(
      (item) => item.service.toString() === validServiceId
    );

    if (!serviceItem) {
      throw buildServiceError(
        "Selected service is not assigned to the specified staff member",
        400
      );
    }
  }

  return {
    service,
    validServiceId,
    validStaffId,
  };
};

const normalizeWaitlistDate = (date) => {
  try {
    return normalizeQueueDate(date);
  } catch (error) {
    throw buildServiceError(error.message, error.statusCode || 400);
  }
};

const ensureFromTime = (fromTime) => {
  const normalized = fromTime || moment().format("HH:mm");
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

  if (!timeRegex.test(normalized)) {
    throw buildServiceError("Invalid fromTime format. Use HH:MM format", 400);
  }

  return normalized;
};

const computeQueueWaitByStaff = (appointments) => {
  const waitByStaff = new Map();

  appointments.forEach((appointment) => {
    if (!appointment.staff?._id) {
      return;
    }

    const staffId = appointment.staff._id.toString();
    const duration = Math.max(
      Number(appointment.duration) || Number(appointment.service?.duration) || 0,
      0
    );
    waitByStaff.set(staffId, (waitByStaff.get(staffId) || 0) + duration);
  });

  return waitByStaff;
};

const buildCandidateSlots = async (
  business,
  { service, serviceId, staffId, date, fromTime, timezoneOffset }
) => {
  const normalizedDate = normalizeWaitlistDate(date);
  const activeWalkIns = await getOrderedActiveWalkIns(business._id, { date });
  const waitByStaff = computeQueueWaitByStaff(activeWalkIns);
  const availability = await getAvailabilityForBusiness({
    business,
    service,
    serviceId,
    staffId,
    date,
    timezoneOffset,
  });
  const baseMoment = moment(fromTime, "HH:mm");
  const candidateSlots = [];

  availability.availabilityByStaff.forEach((staffAvailability) => {
    const staff = staffAvailability.staff;
    const staffIdString = staff?._id?.toString();
    const duration = Math.max(Number(staffAvailability.duration) || 0, 0);

    if (!staffIdString || duration <= 0) {
      return;
    }

    const estimatedWaitMinutes = waitByStaff.get(staffIdString) || 0;
    const earliestStart = baseMoment
      .clone()
      .add(estimatedWaitMinutes, "minutes");

    staffAvailability.availableSlots.forEach((availableSlot) => {
      const slotStart = moment(availableSlot, "HH:mm");

      if (slotStart.isBefore(earliestStart)) {
        return;
      }

      const slotEnd = slotStart.clone().add(duration, "minutes");
      candidateSlots.push({
        staff,
        date: normalizedDate,
        estimatedWaitMinutes,
        duration,
        slotStart: slotStart.format("HH:mm"),
        slotEnd: slotEnd.format("HH:mm"),
      });
    });
  });

  return candidateSlots.sort((left, right) => {
    const leftStaff = left.staff._id.toString();
    const rightStaff = right.staff._id.toString();

    if (left.slotStart !== right.slotStart) {
      return moment(left.slotStart, "HH:mm").diff(
        moment(right.slotStart, "HH:mm")
      );
    }

    return leftStaff.localeCompare(rightStaff);
  });
};

const buildActiveWaitlistQuery = ({
  businessId,
  serviceId,
  date,
  staffId = null,
  includeAnyStaff = false,
}) => ({
  business: { $eq: businessId },
  service: { $eq: serviceId },
  date: { $eq: date },
  status: { $eq: "active" },
  $or: staffId
    ? [{ staff: null }, { staff: { $eq: staffId } }]
    : includeAnyStaff
      ? [{ staff: null }, { staff: { $ne: null } }]
      : [{ staff: null }],
});

const getActiveWaitlistEntries = (filters) =>
  waitlistPopulate(WaitlistEntry.find(buildActiveWaitlistQuery(filters)).sort({ createdAt: 1 }));

const isEntryCompatibleWithSlot = (entry, slot) => {
  const entryStart = moment(entry.timeWindowStart, "HH:mm");
  const entryEnd = moment(entry.timeWindowEnd, "HH:mm");
  const slotStart = moment(slot.slotStart, "HH:mm");
  const slotEnd = moment(slot.slotEnd, "HH:mm");
  const staffCompatible =
    !entry.staff || entry.staff._id.toString() === slot.staff._id.toString();

  return (
    staffCompatible &&
    slotStart.isSameOrAfter(entryStart) &&
    slotEnd.isSameOrBefore(entryEnd)
  );
};

const createWaitlistEntryForOwner = async (ownerId, payload) => {
  const {
    date,
    timeWindowStart,
    timeWindowEnd,
    source = "manual",
    notes = "",
  } = payload;

  if (!date || !timeWindowStart || !timeWindowEnd) {
    throw buildServiceError(
      "date, timeWindowStart, and timeWindowEnd are required",
      400
    );
  }

  ensureTimeWindow(timeWindowStart, timeWindowEnd);

  if (!VALID_SOURCES.includes(source)) {
    throw buildServiceError("Invalid waitlist source", 400);
  }

  const business = await getBusinessForOwner(ownerId);
  const client = await resolveBusinessClient(business, payload);
  const { validServiceId, validStaffId } = await resolveWaitlistScope(
    business._id,
    payload
  );

  const waitlistEntry = await WaitlistEntry.create({
    business: business._id,
    client: client._id,
    service: validServiceId,
    staff: validStaffId,
    date: normalizeWaitlistDate(date),
    timeWindowStart,
    timeWindowEnd,
    source,
    notes,
    createdBy: ownerId,
  });

  return WaitlistEntry.findById(waitlistEntry._id)
    .populate("client", "firstName lastName email phone registrationStatus")
    .populate("service", "name price currency")
    .populate("staff", "firstName lastName");
};

const getWaitlistEntriesForOwner = async (ownerId, query = {}) => {
  const business = await getBusinessForOwner(ownerId);
  const status = query.status || "active";
  if (!["active", "matched", "cancelled", "expired"].includes(status)) {
    throw buildServiceError("Invalid waitlist status", 400);
  }

  const filters = {
    business: { $eq: business._id },
    status: { $eq: status },
  };

  if (query.serviceId) {
    filters.service = {
      $eq: ensureObjectIdString(query.serviceId, "Service ID is invalid"),
    };
  }

  if (query.staffId) {
    filters.staff = {
      $eq: ensureObjectIdString(query.staffId, "Staff ID is invalid"),
    };
  }

  if (query.date) {
    filters.date = { $eq: normalizeWaitlistDate(query.date) };
  }

  return waitlistPopulate(WaitlistEntry.find(filters).sort({ createdAt: 1 }));
};

const findWaitlistMatchesForOwner = async (ownerId, payload) => {
  const { date, startTime, endTime } = payload;
  if (!date || !startTime || !endTime || !payload.serviceId) {
    throw buildServiceError(
      "serviceId, date, startTime, and endTime are required",
      400
    );
  }

  ensureTimeWindow(startTime, endTime);

  const business = await getBusinessForOwner(ownerId);
  const { validServiceId, validStaffId } = await resolveWaitlistScope(
    business._id,
    payload
  );
  const normalizedDate = normalizeWaitlistDate(date);

  const activeEntries = await getActiveWaitlistEntries({
    businessId: business._id,
    serviceId: validServiceId,
    date: normalizedDate,
    staffId: validStaffId,
  });

  const slotStart = moment(startTime, "HH:mm");
  const slotEnd = moment(endTime, "HH:mm");

  return activeEntries.filter((entry) => {
    const entryStart = moment(entry.timeWindowStart, "HH:mm");
    const entryEnd = moment(entry.timeWindowEnd, "HH:mm");
    return (
      slotStart.isSameOrAfter(entryStart) &&
      slotEnd.isSameOrBefore(entryEnd)
    );
  });
};

const getFillGapCandidatesForBusiness = async (businessId, query = {}) => {
  const { serviceId, date, staffId } = query;
  const fromTime = ensureFromTime(query.fromTime);
  const business = await Business.findById(businessId);

  if (!business) {
    throw buildServiceError("Business not found", 404);
  }

  const { service, validServiceId, validStaffId } = await resolveWaitlistScope(
    businessId,
    { serviceId, staffId }
  );
  const normalizedDate = normalizeWaitlistDate(date);

  const candidateSlots = await buildCandidateSlots(business, {
    service,
    serviceId: validServiceId,
    staffId: validStaffId,
    date,
    fromTime,
    timezoneOffset: query.timezoneOffset,
  });

  const entries = await getActiveWaitlistEntries({
    businessId,
    serviceId: validServiceId,
    date: normalizedDate,
    staffId: validStaffId,
    includeAnyStaff: !validStaffId,
  });

  const matchedEntryIds = new Set();

  return candidateSlots.reduce((candidates, slot) => {
    const compatibleEntries = entries.filter(
      (entry) =>
        !matchedEntryIds.has(entry._id.toString()) &&
        isEntryCompatibleWithSlot(entry, slot)
    );

    if (compatibleEntries.length === 0) {
      return candidates;
    }

    compatibleEntries.forEach((entry) => {
      matchedEntryIds.add(entry._id.toString());
    });

    candidates.push({
      staff: {
        _id: slot.staff._id,
        firstName: slot.staff.firstName,
        lastName: slot.staff.lastName,
      },
      date: slot.date,
      slotStart: slot.slotStart,
      slotEnd: slot.slotEnd,
      estimatedWaitMinutes: slot.estimatedWaitMinutes,
      duration: slot.duration,
      compatibleEntries,
    });

    return candidates;
  }, []);
};

const getFillGapCandidatesForOwner = async (ownerId, query = {}) => {
  const { serviceId, date } = query;

  if (!serviceId || !date) {
    throw buildServiceError("serviceId and date are required", 400);
  }

  const business = await getBusinessForOwner(ownerId);
  return getFillGapCandidatesForBusiness(business._id, query);
};

module.exports = {
  createWaitlistEntryForOwner,
  getWaitlistEntriesForOwner,
  findWaitlistMatchesForOwner,
  getFillGapCandidatesForBusiness,
  getFillGapCandidatesForOwner,
  normalizeWaitlistDate,
};
