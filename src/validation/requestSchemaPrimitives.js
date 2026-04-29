const mongoose = require("mongoose");
const { z } = require("../middleware/validateRequest");

const toUndefinedIfBlank = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const toNumberInput = (value) => {
  const normalized = toUndefinedIfBlank(value);
  if (normalized === undefined) return undefined;
  return typeof normalized === "string" ? Number(normalized) : normalized;
};

const toBooleanInput = (value) => {
  const normalized = toUndefinedIfBlank(value);
  if (normalized === undefined || typeof normalized === "boolean") {
    return normalized;
  }

  if (typeof normalized === "string") {
    const lowered = normalized.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(lowered)) return true;
    if (["false", "0", "no", "off"].includes(lowered)) return false;
  }

  return normalized;
};

const numberInput = (schema) => z.preprocess(toNumberInput, schema);

const booleanInput = (schema) => z.preprocess(toBooleanInput, schema);

const optionalBoolean = booleanInput(z.boolean().optional());

const optionalString = (maxLength) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null) return undefined;
      return String(value).trim();
    },
    z.string().max(maxLength).optional()
  );

const requiredString = (maxLength) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null) return value;
      return String(value).trim();
    },
    z.string().min(1).max(maxLength)
  );

const objectId = z
  .string()
  .trim()
  .refine((value) => mongoose.Types.ObjectId.isValid(value), {
    message: "must be a valid ObjectId",
  });

const optionalObjectId = z.preprocess(
  toUndefinedIfBlank,
  objectId.optional()
);

const hasValidCalendarDate = (value) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const dateOnly = z
  .string()
  .trim()
  .refine((value) => {
    const dateOnlyFormat = /^\d{4}-\d{2}-\d{2}$/;
    const isoDateTimeFormat =
      /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/;

    if (!dateOnlyFormat.test(value) && !isoDateTimeFormat.test(value)) {
      return false;
    }

    return hasValidCalendarDate(value);
  }, "must use YYYY-MM-DD or ISO date-time format with a valid calendar date");

const timeOnly = z
  .string()
  .trim()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "must use HH:MM format");

const appointmentStartTime = z
  .string()
  .trim()
  .regex(
    /^(\d{1,2}):([0-5]\d)(?:\s*(AM|PM))?$/i,
    "must use HH:MM or HH:MM AM/PM format"
  )
  .refine((value) => {
    const match = value.match(/^(\d{1,2}):([0-5]\d)(?:\s*(AM|PM))?$/i);
    if (!match) return false;
    const hour = Number(match[1]);
    const period = match[3]?.toUpperCase();
    return period ? hour >= 1 && hour <= 12 : hour >= 0 && hour <= 23;
  }, "must use a valid time of day");

const parseTimezoneOffsetInput = (timezoneOffset) => {
  if (timezoneOffset === undefined || timezoneOffset === null || timezoneOffset === "") {
    return null;
  }

  const raw = String(timezoneOffset).trim();
  const hhMmOffset = raw.match(/^([+-]?)(\d{1,2}):(\d{2})$/);
  if (hhMmOffset) {
    const sign = hhMmOffset[1] === "-" ? -1 : 1;
    const hours = Number(hhMmOffset[2]);
    const minutes = Number(hhMmOffset[3]);
    return minutes <= 59 ? sign * (hours * 60 + minutes) : null;
  }

  return /^[-+]?\d+$/.test(raw) ? Number(raw) : null;
};

const timezoneOffset = z
  .preprocess(toUndefinedIfBlank, z.union([z.string(), z.number()]).optional())
  .refine((value) => {
    if (value === undefined) return true;
    const parsed = parseTimezoneOffsetInput(value);
    return parsed !== null && Math.abs(parsed) <= 1440;
  }, "must be a valid timezone offset");

const nonNegativeMoney = numberInput(z.number().finite().nonnegative());
const positiveMoney = numberInput(z.number().finite().positive());
const optionalNonNegativeMoney = numberInput(
  z.number().finite().nonnegative().optional()
);
const optionalPositiveMoney = numberInput(
  z.number().finite().positive().optional()
);
const optionalIntegerRange = (min, max) =>
  numberInput(z.number().int().min(min).max(max).optional());
const optionalIntegerMin = (min) =>
  numberInput(z.number().int().min(min).optional());
const optionalFiniteNumber = numberInput(z.number().finite().optional());
const optionalArray = (schema, maxLength) =>
  z.preprocess(
    toUndefinedIfBlank,
    z.array(schema).max(maxLength).optional()
  );

const idParams = z.object({ id: objectId }).strict();
const checkoutIdParams = z.object({ checkoutId: objectId }).strict();
const appointmentIdParams = z.object({ appointmentId: objectId }).strict();
const clientIdParams = z.object({ clientId: objectId }).strict();
const penaltyIdParams = z.object({ penaltyId: objectId }).strict();

module.exports = {
  appointmentIdParams,
  appointmentStartTime,
  booleanInput,
  checkoutIdParams,
  clientIdParams,
  dateOnly,
  idParams,
  nonNegativeMoney,
  numberInput,
  objectId,
  optionalArray,
  optionalBoolean,
  optionalFiniteNumber,
  optionalIntegerMin,
  optionalIntegerRange,
  optionalNonNegativeMoney,
  optionalObjectId,
  optionalPositiveMoney,
  optionalString,
  penaltyIdParams,
  positiveMoney,
  requiredString,
  timeOnly,
  timezoneOffset,
  toUndefinedIfBlank,
  toNumberInput,
  z,
};
