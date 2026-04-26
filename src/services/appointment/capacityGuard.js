const mongoose = require("mongoose");
const moment = require("moment");
const Appointment = require("../../models/appointment");
const CapacityLock = require("../../models/capacityLock");

const NON_BLOCKING_CAPACITY_STATUSES = ["Canceled", "No-Show", "Missed"];
const DEFAULT_CONFLICT_MESSAGE =
  "This staff member is not available at the selected time";

const buildCapacityError = (message = DEFAULT_CONFLICT_MESSAGE, statusCode = 409) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const toIdString = (value) => {
  if (!value) return null;
  return String(value._id || value);
};

const normalizeCapacityDate = (date) => {
  const parsed =
    date instanceof Date
      ? moment(date)
      : moment(date, ["YYYY-MM-DD", moment.ISO_8601], true);

  if (!parsed.isValid()) {
    throw buildCapacityError("Invalid appointment date", 400);
  }

  return parsed.startOf("day").toDate();
};

const getCapacityDateKey = (date) =>
  moment(normalizeCapacityDate(date)).format("YYYY-MM-DD");

const buildCapacityLockDescriptor = ({ businessId, staffId, date }) => {
  const businessKey = toIdString(businessId);
  const staffKey = toIdString(staffId) || "unassigned";
  const dateKey = getCapacityDateKey(date);

  if (!businessKey) {
    throw buildCapacityError("Business is required for capacity guard", 400);
  }

  return {
    lockKey: `${businessKey}:${staffKey}:${dateKey}`,
    business: businessId,
    staff: staffId || null,
    dateKey,
  };
};

const ensureCapacityLock = async (descriptor) => {
  try {
    await CapacityLock.updateOne(
      { _id: descriptor.lockKey },
      {
        $setOnInsert: {
          _id: descriptor.lockKey,
          lockKey: descriptor.lockKey,
          business: descriptor.business,
          staff: descriptor.staff,
          dateKey: descriptor.dateKey,
        },
        $set: {
          touchedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
  }
};

const touchCapacityLock = async (descriptor, session) => {
  const result = await CapacityLock.updateOne(
    { _id: descriptor.lockKey },
    {
      $inc: { version: 1 },
      $set: { touchedAt: new Date() },
    },
    { session }
  );

  const matched = result.matchedCount ?? result.n ?? 0;
  if (matched === 0) {
    throw buildCapacityError("Capacity lock could not be acquired", 409);
  }
};

const buildCapacityConflictFilter = ({
  businessId,
  staffId,
  date,
  startTime,
  endTime,
  excludeAppointmentId,
}) => {
  const dayStart = normalizeCapacityDate(date);
  const dayEnd = moment(dayStart).endOf("day").toDate();
  const filter = {
    business: businessId,
    date: { $gte: dayStart, $lte: dayEnd },
    status: { $nin: NON_BLOCKING_CAPACITY_STATUSES },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  };

  if (staffId) {
    filter.staff = staffId;
  }

  if (excludeAppointmentId) {
    filter._id = { $ne: excludeAppointmentId };
  }

  return filter;
};

const findCapacityConflict = ({
  businessId,
  staffId,
  date,
  startTime,
  endTime,
  excludeAppointmentId,
  session,
}) => {
  const query = Appointment.findOne(
    buildCapacityConflictFilter({
      businessId,
      staffId,
      date,
      startTime,
      endTime,
      excludeAppointmentId,
    })
  );

  return session ? query.session(session) : query;
};

const runWithCapacityGuard = async ({
  businessId,
  staffId,
  date,
  startTime,
  endTime,
  conflictMessage = DEFAULT_CONFLICT_MESSAGE,
  operation,
}) => {
  if (typeof operation !== "function") {
    throw buildCapacityError("Capacity guard operation is required", 500);
  }

  const descriptor = buildCapacityLockDescriptor({ businessId, staffId, date });
  await ensureCapacityLock(descriptor);

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      await touchCapacityLock(descriptor, session);

      const conflictingAppointment = await findCapacityConflict({
        businessId,
        staffId,
        date,
        startTime,
        endTime,
        session,
      });

      if (conflictingAppointment) {
        throw buildCapacityError(conflictMessage, 409);
      }

      result = await operation({ session });
    });

    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  buildCapacityConflictFilter,
  buildCapacityError,
  findCapacityConflict,
  NON_BLOCKING_CAPACITY_STATUSES,
  normalizeCapacityDate,
  runWithCapacityGuard,
};
