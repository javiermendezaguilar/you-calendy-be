const moment = require("moment");
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

const VALID_SOURCES = ["manual", "walk_in_overflow", "booking_overflow"];

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
  const parsed = moment(date, "YYYY-MM-DD", true);
  if (!parsed.isValid()) {
    throw buildServiceError("Date must use YYYY-MM-DD format", 400);
  }

  return parsed.startOf("day").toDate();
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

  return WaitlistEntry.find(filters)
    .sort({ createdAt: 1 })
    .populate("client", "firstName lastName email phone registrationStatus")
    .populate("service", "name price currency")
    .populate("staff", "firstName lastName");
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

  const activeEntries = await WaitlistEntry.find({
    business: { $eq: business._id },
    service: { $eq: validServiceId },
    date: { $eq: normalizedDate },
    status: { $eq: "active" },
    $or: validStaffId
      ? [{ staff: null }, { staff: { $eq: validStaffId } }]
      : [{ staff: null }],
  })
    .sort({ createdAt: 1 })
    .populate("client", "firstName lastName email phone registrationStatus")
    .populate("service", "name price currency")
    .populate("staff", "firstName lastName");

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

module.exports = {
  createWaitlistEntryForOwner,
  getWaitlistEntriesForOwner,
  findWaitlistMatchesForOwner,
};
