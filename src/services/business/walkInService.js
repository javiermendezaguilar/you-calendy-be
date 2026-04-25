const moment = require("moment");
const Appointment = require("../../models/appointment");
const Service = require("../../models/service");
const Staff = require("../../models/staff");
const {
  buildServiceError,
  ensureObjectIdString,
} = require("./coreService");
const {
  getBusinessForOwner,
  resolveBusinessClient,
} = require("./shared");
const {
  computeQueueMetrics,
  getOrderedActiveWalkIns,
  getQueueResponseForBusiness,
} = require("./queueService");
const {
  findCapacityConflict,
  runWithCapacityGuard,
} = require("../appointment/capacityGuard");
const { recordDomainEvent } = require("../domainEventService");

const buildCheckedInTimestamps = (userId) => ({
  checkedInAt: new Date(),
  checkedInBy: userId,
  serviceStartedAt: null,
  serviceStartedBy: null,
});

const populateWalkInQuery = (query) =>
  query
    .populate("client", "firstName lastName email phone registrationStatus")
    .populate("service", "name price currency duration")
    .populate("staff", "firstName lastName");

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

  const conflictingAppointment = await findCapacityConflict({
    businessId,
    staffId: validStaffId,
    date: dayStart,
    startTime,
    endTime,
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
  const client = await resolveBusinessClient(business, payload);
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

  const activeWalkIns = await getOrderedActiveWalkIns(business._id);
  const estimatedWaitMinutes = computeQueueMetrics(activeWalkIns)
    .filter(
      ({ appointment }) =>
        appointment.staff && appointment.staff._id.toString() === staff._id.toString()
    )
    .slice(-1)
    .map(({ estimatedWaitMinutes: currentWait, appointment }) => {
      const duration = Math.max(
        Number(appointment.duration) || Number(appointment.service?.duration) || 0,
        0
      );
      return currentWait + duration;
    })[0] || 0;

  const appointmentPayload = {
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
    queuePosition: activeWalkIns.length + 1,
    estimatedWaitMinutes,
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
  };

  const appointment = await runWithCapacityGuard({
    businessId: business._id,
    staffId: staff._id,
    date: normalizedDate,
    startTime: payload.startTime,
    endTime,
    conflictMessage: "This staff member is not available at the selected time",
    operation: async ({ session }) => {
      const [createdAppointment] = await Appointment.create(
        [appointmentPayload],
        { session }
      );
      return createdAppointment;
    },
  });

  await recordDomainEvent({
    type: "walkin_created",
    actorId: ownerId,
    shopId: business._id,
    correlationId: appointment._id,
    payload: {
      appointmentId: appointment._id,
      clientId: appointment.client,
      serviceId: appointment.service,
      staffId: appointment.staff,
      queuePosition: appointment.queuePosition,
      estimatedWaitMinutes: appointment.estimatedWaitMinutes,
    },
  });

  return populateWalkInQuery(Appointment.findById(appointment._id));
};

const getWalkInQueueForOwner = async (ownerId) => {
  const business = await getBusinessForOwner(ownerId);
  return getQueueResponseForBusiness(business._id);
};

module.exports = {
  createWalkInForOwner,
  getWalkInQueueForOwner,
};
