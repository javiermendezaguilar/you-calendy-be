const moment = require("moment");
const Appointment = require("../../models/appointment");

const ACTIVE_WALK_IN_VISIT_STATUSES = ["checked_in", "not_started"];
const ACTIVE_QUEUE_STATUSES = ["waiting", "called"];

const queueSort = {
  queuePriority: -1,
  queueEnteredAt: 1,
  "operationalTimestamps.checkedInAt": 1,
  createdAt: 1,
};

const populateWalkInQuery = (query) =>
  query
    .populate("client", "firstName lastName email phone registrationStatus")
    .populate("service", "name price currency duration")
    .populate("staff", "firstName lastName");

const normalizeQueueDate = (date) => {
  if (!date) {
    return null;
  }

  const parsed = moment(date, "YYYY-MM-DD", true);
  if (!parsed.isValid()) {
    const error = new Error("Date must use YYYY-MM-DD format");
    error.statusCode = 400;
    throw error;
  }

  return parsed.startOf("day").toDate();
};

const buildActiveWalkInQuery = (businessId, options = {}) => {
  const filters = {
    business: businessId,
    visitType: "walk_in",
    status: { $nin: ["Canceled", "Completed", "No-Show", "Missed"] },
    $or: [
      { queueStatus: { $in: ACTIVE_QUEUE_STATUSES } },
      {
        queueStatus: { $in: [null, "none"] },
        visitStatus: { $in: ACTIVE_WALK_IN_VISIT_STATUSES },
      },
      {
        queueStatus: { $exists: false },
        visitStatus: { $in: ACTIVE_WALK_IN_VISIT_STATUSES },
      },
    ],
  };

  const normalizedDate = normalizeQueueDate(options.date);
  if (normalizedDate) {
    filters.date = { $eq: normalizedDate };
  }

  return filters;
};

const computeQueueMetrics = (appointments) => {
  const waitByStaff = new Map();

  return appointments.map((appointment, index) => {
    const staffId = appointment.staff?._id?.toString() || "unassigned";
    const estimatedWaitMinutes = waitByStaff.get(staffId) || 0;
    const duration = Math.max(
      Number(appointment.duration) || Number(appointment.service?.duration) || 0,
      0
    );

    waitByStaff.set(staffId, estimatedWaitMinutes + duration);

    return {
      appointment,
      queuePosition: index + 1,
      estimatedWaitMinutes,
    };
  });
};

const syncQueueMetrics = async (appointments) => {
  const metrics = computeQueueMetrics(appointments);

  await Promise.all(
    metrics.map(({ appointment, queuePosition, estimatedWaitMinutes }) => {
      if (
        appointment.queuePosition === queuePosition &&
        appointment.estimatedWaitMinutes === estimatedWaitMinutes
      ) {
        return null;
      }

      appointment.queuePosition = queuePosition;
      appointment.estimatedWaitMinutes = estimatedWaitMinutes;
      return appointment.save();
    })
  );

  return metrics;
};

const getOrderedActiveWalkIns = (businessId, options = {}) =>
  populateWalkInQuery(
    Appointment.find(buildActiveWalkInQuery(businessId, options)).sort(queueSort)
  );

const getQueueResponseForBusiness = async (businessId, options = {}) => {
  const appointments = await getOrderedActiveWalkIns(businessId, options);
  const metrics = await syncQueueMetrics(appointments);

  return metrics.map(({ appointment, queuePosition, estimatedWaitMinutes }) => ({
    ...appointment.toObject(),
    queuePosition,
    estimatedWaitMinutes,
  }));
};

module.exports = {
  ACTIVE_QUEUE_STATUSES,
  computeQueueMetrics,
  getOrderedActiveWalkIns,
  getQueueResponseForBusiness,
  normalizeQueueDate,
};
