const mongoose = require("mongoose");
const Service = require("../../models/service");
const Staff = require("../../models/staff");
const {
  applyTotalizationToCheckout,
  createTotalizationError,
  roundMoney,
} = require("./totalizationService");

const SERVICE_LINE_SOURCE = {
  RESERVED_DEFAULT: "reserved_service_default",
  MANUAL_ADJUSTMENT: "manual_adjustment",
};

const MAX_SERVICE_LINES = 20;
const MAX_QUANTITY = 99;
const MAX_DURATION_MINUTES = 1440;
const MAX_NOTE_LENGTH = 500;

const createServiceLineError = createTotalizationError;

const toId = (documentOrId) => {
  if (!documentOrId) {
    return null;
  }

  return documentOrId._id || documentOrId;
};

const toObjectIdOrThrow = (value, fieldName) => {
  const rawValue = toId(value);
  if (!rawValue || !mongoose.Types.ObjectId.isValid(rawValue)) {
    throw createServiceLineError(`Invalid ${fieldName}`);
  }

  return new mongoose.Types.ObjectId(rawValue.toString());
};

const normalizeIntegerRange = ({ value, fallback, fieldName, min, max }) => {
  const normalized = value === undefined || value === null || value === ""
    ? fallback
    : Number(value);

  if (
    !Number.isInteger(normalized) ||
    normalized < min ||
    normalized > max
  ) {
    throw createServiceLineError(
      `${fieldName} must be an integer from ${min} to ${max}`
    );
  }

  return normalized;
};

const normalizeQuantity = (value) =>
  normalizeIntegerRange({
    value,
    fallback: 1,
    fieldName: "quantity",
    min: 1,
    max: MAX_QUANTITY,
  });

const normalizeDurationMinutes = (value) =>
  normalizeIntegerRange({
    value,
    fallback: 0,
    fieldName: "durationMinutes",
    min: 0,
    max: MAX_DURATION_MINUTES,
  });

const normalizeMoney = (value, fieldName, { allowNegative = false } = {}) => {
  const inputIsBlank = value === undefined || value === null || value === "";
  const amount = inputIsBlank ? 0 : Number(value);

  if (!Number.isFinite(amount) || (!allowNegative && amount < 0)) {
    throw createServiceLineError(
      `${fieldName} must be a ${allowNegative ? "" : "non-negative "}number`
    );
  }

  return roundMoney(amount);
};

const normalizeNote = (value) => {
  const note = String(value || "").trim();
  if (note.length > MAX_NOTE_LENGTH) {
    throw createServiceLineError(
      `note must be ${MAX_NOTE_LENGTH} characters or fewer`
    );
  }

  return note;
};

const buildStaffSnapshot = (staff) => {
  if (!staff) {
    return {
      id: null,
      firstName: "",
      lastName: "",
    };
  }

  return {
    id: staff._id || staff.id || null,
    firstName: staff.firstName || "",
    lastName: staff.lastName || "",
  };
};

const getAppointmentServiceLineUnitPrice = (appointment) => {
  if (appointment?.promotion?.applied && appointment?.promotion?.originalPrice) {
    return Number(appointment.promotion.originalPrice) || 0;
  }

  if (appointment?.flashSale?.applied && appointment?.flashSale?.originalPrice) {
    return Number(appointment.flashSale.originalPrice) || 0;
  }

  const service = appointment?.service || {};
  return Number(appointment?.price) || Number(service.price) || 0;
};

const buildServiceLineSnapshot = ({
  service,
  staff = null,
  quantity = 1,
  unitPrice = 0,
  durationMinutes = 0,
  adjustmentAmount = 0,
  source = SERVICE_LINE_SOURCE.MANUAL_ADJUSTMENT,
  note = "",
}) => {
  const normalizedUnitPrice = roundMoney(unitPrice);
  const normalizedAdjustment = roundMoney(adjustmentAmount);
  const lineTotal = roundMoney(
    quantity * normalizedUnitPrice + normalizedAdjustment
  );

  if (lineTotal < 0) {
    throw createServiceLineError("Line total cannot be negative");
  }

  return {
    service: {
      id: service?._id || service?.id || null,
      name: service?.name || "",
    },
    staff: buildStaffSnapshot(staff),
    quantity,
    unitPrice: normalizedUnitPrice,
    durationMinutes,
    adjustmentAmount: normalizedAdjustment,
    lineTotal,
    source,
    note,
  };
};

const buildDefaultServiceLinesFromAppointment = (appointment) => {
  const service = appointment?.service || {};
  const staff = appointment?.staff || null;
  const unitPrice = getAppointmentServiceLineUnitPrice(appointment);
  const durationMinutes =
    Number(appointment?.duration) || Number(service.duration) || 0;

  return [
    buildServiceLineSnapshot({
      service: {
        _id: toId(service),
        name: service.name || "",
      },
      staff,
      quantity: 1,
      unitPrice,
      durationMinutes,
      adjustmentAmount: 0,
      source: SERVICE_LINE_SOURCE.RESERVED_DEFAULT,
      note: "",
    }),
  ];
};

const sumServiceLines = (serviceLines = []) =>
  roundMoney(
    serviceLines.reduce((sum, line) => sum + (Number(line.lineTotal) || 0), 0)
  );

const normalizeCheckoutServiceLines = async ({
  businessId,
  payloadLines,
  defaultStaffId = null,
}) => {
  if (!Array.isArray(payloadLines)) {
    throw createServiceLineError("serviceLines must be an array");
  }

  if (payloadLines.length < 1 || payloadLines.length > MAX_SERVICE_LINES) {
    throw createServiceLineError(
      `serviceLines must include 1 to ${MAX_SERVICE_LINES} lines`
    );
  }

  const preparedLines = payloadLines.map((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw createServiceLineError("Each service line must be an object");
    }

    const serviceId = toObjectIdOrThrow(line.serviceId, "serviceId");
    const staffInput =
      line.staffId === undefined || line.staffId === null || line.staffId === ""
        ? defaultStaffId
        : line.staffId;
    const staffId = staffInput ? toObjectIdOrThrow(staffInput, "staffId") : null;

    return {
      raw: line,
      serviceId,
      staffId,
    };
  });

  const serviceIds = [
    ...new Set(preparedLines.map((line) => line.serviceId.toString())),
  ];
  const staffIds = [
    ...new Set(
      preparedLines
        .filter((line) => line.staffId)
        .map((line) => line.staffId.toString())
    ),
  ];

  const [services, staffMembers] = await Promise.all([
    Service.find({
      _id: { $in: serviceIds },
      business: businessId,
      isActive: true,
    }).lean(),
    staffIds.length
      ? Staff.find({
          _id: { $in: staffIds },
          business: businessId,
        }).lean()
      : [],
  ]);

  const serviceById = new Map(
    services.map((service) => [service._id.toString(), service])
  );
  const staffById = new Map(
    staffMembers.map((staff) => [staff._id.toString(), staff])
  );

  return preparedLines.map(({ raw, serviceId, staffId }) => {
    const service = serviceById.get(serviceId.toString());
    if (!service) {
      throw createServiceLineError("Service not found for checkout", 404);
    }

    const staff = staffId ? staffById.get(staffId.toString()) : null;
    if (staffId && !staff) {
      throw createServiceLineError("Staff not found for checkout", 404);
    }

    const quantity = normalizeQuantity(raw.quantity);
    const unitPrice = normalizeMoney(
      raw.unitPrice === undefined ? service.price : raw.unitPrice,
      "unitPrice"
    );
    const durationMinutes = normalizeDurationMinutes(
      raw.durationMinutes === undefined ? service.duration : raw.durationMinutes
    );
    const adjustmentAmount = normalizeMoney(
      raw.adjustmentAmount,
      "adjustmentAmount",
      { allowNegative: true }
    );

    return buildServiceLineSnapshot({
      service,
      staff,
      quantity,
      unitPrice,
      durationMinutes,
      adjustmentAmount,
      source: SERVICE_LINE_SOURCE.MANUAL_ADJUSTMENT,
      note: normalizeNote(raw.note),
    });
  });
};

const applyServiceLinesToCheckout = (checkout, serviceLines) => {
  return applyTotalizationToCheckout(checkout, { serviceLines });
};

const buildServiceLineSnapshotList = (serviceLines = []) =>
  serviceLines.map((line) =>
    buildServiceLineSnapshot({
      service: {
        _id: line.service?.id || null,
        name: line.service?.name || "",
      },
      staff: line.staff?.id
        ? {
            _id: line.staff.id,
            firstName: line.staff.firstName || "",
            lastName: line.staff.lastName || "",
          }
        : null,
      quantity: Number(line.quantity) || 1,
      unitPrice: Number(line.unitPrice) || 0,
      durationMinutes: Number(line.durationMinutes) || 0,
      adjustmentAmount: Number(line.adjustmentAmount) || 0,
      source: line.source || SERVICE_LINE_SOURCE.MANUAL_ADJUSTMENT,
      note: line.note || "",
    })
  );

module.exports = {
  SERVICE_LINE_SOURCE,
  applyServiceLinesToCheckout,
  buildDefaultServiceLinesFromAppointment,
  buildServiceLineSnapshotList,
  getAppointmentServiceLineUnitPrice,
  normalizeCheckoutServiceLines,
  sumServiceLines,
};
