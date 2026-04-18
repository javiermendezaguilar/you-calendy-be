const moment = require("moment");
const Business = require("../../models/User/business");
const Client = require("../../models/client");
const Service = require("../../models/service");
const Staff = require("../../models/staff");
const WaitlistEntry = require("../../models/waitlistEntry");
const { normalizePhone, getCountryCode } = require("../../utils/index");
const {
  buildServiceError,
  ensureObjectIdString,
} = require("./coreService");

const VALID_SOURCES = ["manual", "walk_in_overflow", "booking_overflow"];

const getBusinessForOwner = async (ownerId) => {
  const business = await Business.findOne({ owner: ownerId });
  if (!business) {
    throw buildServiceError("Business not found", 404);
  }
  return business;
};

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

const resolveWaitlistClient = async (business, payload) => {
  const { clientId, firstName = "", lastName = "", phone, email, staffId } = payload;

  if (clientId) {
    const validClientId = ensureObjectIdString(clientId, "Client ID is invalid");
    const client = await Client.findOne({
      _id: { $eq: validClientId },
      business: { $eq: business._id },
    });

    if (!client) {
      throw buildServiceError("Client not found", 404);
    }

    return client;
  }

  if (!phone) {
    throw buildServiceError(
      "Phone is required when clientId is not provided",
      400
    );
  }

  const countryHint = getCountryCode(business.contactInfo?.phone);
  const normalizedPhone = normalizePhone(phone, countryHint);
  const { client } = await Client.findOrCreateUnregistered(business._id, {
    firstName,
    lastName,
    phone: normalizedPhone,
    email: email || undefined,
  });

  if (staffId) {
    client.staff = ensureObjectIdString(staffId, "Staff ID is invalid");
    await client.save();
  }

  return client;
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
  const client = await resolveWaitlistClient(business, payload);
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
  const filters = {
    business: business._id,
    status: query.status || "active",
  };

  if (query.serviceId) {
    filters.service = ensureObjectIdString(query.serviceId, "Service ID is invalid");
  }

  if (query.staffId) {
    filters.staff = ensureObjectIdString(query.staffId, "Staff ID is invalid");
  }

  if (query.date) {
    filters.date = normalizeWaitlistDate(query.date);
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
    business: business._id,
    service: validServiceId,
    date: normalizedDate,
    status: "active",
    $or: [{ staff: null }, { staff: validStaffId || null }, ...(validStaffId ? [{ staff: validStaffId }] : [])],
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
