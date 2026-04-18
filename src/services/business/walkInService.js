const moment = require("moment");
const Appointment = require("../../models/appointment");
const Business = require("../../models/User/business");
const Client = require("../../models/client");
const Service = require("../../models/service");
const Staff = require("../../models/staff");
const { normalizePhone, getCountryCode } = require("../../utils/index");
const {
  buildServiceError,
  ensureObjectIdString,
} = require("./coreService");

const buildCheckedInTimestamps = (userId) => ({
  checkedInAt: new Date(),
  checkedInBy: userId,
  serviceStartedAt: null,
  serviceStartedBy: null,
});

const getBusinessForOwner = async (ownerId) => {
  const business = await Business.findOne({ owner: ownerId });
  if (!business) {
    const error = new Error("Business not found");
    error.statusCode = 404;
    throw error;
  }

  return business;
};

const resolveWalkInClient = async (business, payload) => {
  const { clientId, firstName = "", lastName = "", phone, email, staffId } = payload;

  if (clientId) {
    const validClientId = ensureObjectIdString(clientId, "Client ID is invalid");
    const client = await Client.findOne({
      _id: { $eq: validClientId },
      business: { $eq: business._id },
    });

    if (!client) {
      const error = new Error("Client not found");
      error.statusCode = 404;
      throw error;
    }

    return client;
  }

  if (!phone) {
    const error = new Error("Phone is required when clientId is not provided");
    error.statusCode = 400;
    throw error;
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

const resolveWalkInSchedule = async ({ businessId, serviceId, staffId, date, startTime }) => {
  if (!serviceId || !staffId || !date || !startTime) {
    const error = new Error(
      "serviceId, staffId, date, and startTime are required"
    );
    error.statusCode = 400;
    throw error;
  }

  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(startTime)) {
    const error = new Error("Invalid start time format. Use HH:MM format");
    error.statusCode = 400;
    throw error;
  }

  const validServiceId = ensureObjectIdString(serviceId, "Service ID is invalid");
  const validStaffId = ensureObjectIdString(staffId, "Staff ID is invalid");

  const service = await Service.findOne({
    _id: { $eq: validServiceId },
    business: { $eq: businessId },
  });
  if (!service) {
    const error = new Error("Service not found");
    error.statusCode = 404;
    throw error;
  }

  const staff = await Staff.findOne({
    _id: { $eq: validStaffId },
    business: { $eq: businessId },
  });
  if (!staff) {
    const error = new Error("Staff member not found");
    error.statusCode = 404;
    throw error;
  }

  const serviceItem = staff.services.find(
    (item) => item.service.toString() === validServiceId
  );
  if (!serviceItem) {
    const error = new Error(
      "Selected service is not assigned to the specified staff member"
    );
    error.statusCode = 400;
    throw error;
  }

  const duration = Number(serviceItem.timeInterval) || Number(service.duration) || 0;
  if (duration <= 0) {
    const error = new Error("Walk-in requires a valid service duration");
    error.statusCode = 400;
    throw error;
  }

  const appointmentDateTime = new Date(date);
  appointmentDateTime.setHours(parseInt(startTime.split(":")[0], 10));
  appointmentDateTime.setMinutes(parseInt(startTime.split(":")[1], 10));
  appointmentDateTime.setSeconds(0, 0);

  const now = new Date();
  now.setSeconds(0, 0);
  if (appointmentDateTime < now) {
    const error = new Error("Cannot create walk-ins in the past");
    error.statusCode = 400;
    throw error;
  }

  const endTime = moment(startTime, "HH:mm").add(duration, "minutes").format("HH:mm");
  const dayStart = moment(date, "YYYY-MM-DD").startOf("day").toDate();
  const dayEnd = moment(date, "YYYY-MM-DD").endOf("day").toDate();

  const conflictingAppointment = await Appointment.findOne({
    business: { $eq: businessId },
    staff: { $eq: validStaffId },
    date: { $gte: dayStart, $lte: dayEnd },
    status: { $nin: ["Canceled", "No-Show"] },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  });

  if (conflictingAppointment) {
    const error = new Error("This staff member is not available at the selected time");
    error.statusCode = 409;
    throw error;
  }

  return {
    service,
    staff,
    duration,
    endTime,
    normalizedDate: moment(date, "YYYY-MM-DD").startOf("day").toDate(),
  };
};

const createWalkInForOwner = async (ownerId, payload) => {
  const business = await getBusinessForOwner(ownerId);
  const client = await resolveWalkInClient(business, payload);
  const { service, staff, duration, endTime, normalizedDate } =
    await resolveWalkInSchedule({
      businessId: business._id,
      serviceId: payload.serviceId,
      staffId: payload.staffId,
      date: payload.date,
      startTime: payload.startTime,
    });

  if (typeof payload.startTime !== "string") {
    throw buildServiceError("Start time is invalid", 400);
  }

  const appointment = await Appointment.create({
    client: client._id,
    business: business._id,
    service: service._id,
    staff: staff._id,
    date: normalizedDate,
    startTime: payload.startTime,
    endTime,
    duration,
    status: "Confirmed",
    bookingStatus: "confirmed",
    visitStatus: "checked_in",
    visitType: "walk_in",
    paymentStatus: "Pending",
    price: Number(service.price) || 0,
    notes: payload.notes || "",
    clientNotes: payload.clientNotes || "",
    promotion: {
      applied: false,
      promotionId: null,
      originalPrice: 0,
      discountAmount: 0,
      discountPercentage: 0,
    },
    flashSale: {
      applied: false,
      flashSaleId: null,
      originalPrice: 0,
      discountAmount: 0,
      discountPercentage: 0,
    },
    operationalTimestamps: buildCheckedInTimestamps(ownerId),
    policySnapshot: Appointment.buildPolicySnapshot(business),
  });

  return Appointment.findById(appointment._id)
    .populate("client", "firstName lastName email phone registrationStatus")
    .populate("service", "name price currency")
    .populate("staff", "firstName lastName");
};

module.exports = {
  createWalkInForOwner,
};
