const {
  idParams,
  objectId,
  optionalBoolean,
  optionalIntegerRange,
  optionalNonNegativeMoney,
  optionalString,
  requiredString,
  toUndefinedIfBlank,
  z,
} = require("./requestSchemaPrimitives");

const SERVICE_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "CHF",
  "CNY",
  "INR",
  "BRL",
];

const serviceCurrency = z.preprocess(
  toUndefinedIfBlank,
  z.enum(SERVICE_CURRENCIES).optional()
);

const optionalRequiredString = (maxLength) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null) return undefined;
      return String(value).trim();
    },
    z.string().min(1).max(maxLength).optional()
  );

const serviceQuery = z
  .object({
    businessId: objectId,
    category: optionalString(120),
  })
  .passthrough();

const serviceCategoriesQuery = z
  .object({
    businessId: objectId,
  })
  .passthrough();

const businessServiceIdParams = z
  .object({
    serviceId: objectId,
  })
  .strict();

const businessServiceWriteShape = {
  type: optionalString(120),
  description: optionalString(2000),
  duration: optionalIntegerRange(0, 1440),
  price: optionalNonNegativeMoney,
  currency: serviceCurrency,
  category: optionalString(120),
  isFromEnabled: optionalBoolean,
  isActive: optionalBoolean,
};

const createBusinessServiceBody = z
  .object({
    name: requiredString(160),
    ...businessServiceWriteShape,
  })
  .passthrough();

const updateBusinessServiceBody = z
  .object({
    name: optionalRequiredString(160),
    ...businessServiceWriteShape,
  })
  .passthrough();

const legacyUpdateServiceBody = z
  .object({
    name: optionalRequiredString(160),
    description: optionalString(2000),
    price: optionalNonNegativeMoney,
    currency: serviceCurrency,
    category: optionalString(120),
    isActive: optionalBoolean,
  })
  .passthrough();

const legacyDeleteServiceBody = z
  .object({
    reason: requiredString(500),
  })
  .passthrough();

module.exports = {
  serviceInputSchemas: {
    listServices: {
      query: serviceQuery,
    },
    serviceCategories: {
      query: serviceCategoriesQuery,
    },
    serviceById: {
      params: idParams,
    },
    updateLegacyService: {
      params: idParams,
      body: legacyUpdateServiceBody,
    },
    deleteLegacyService: {
      params: idParams,
      body: legacyDeleteServiceBody,
    },
    createBusinessService: {
      body: createBusinessServiceBody,
    },
    updateBusinessService: {
      params: businessServiceIdParams,
      body: updateBusinessServiceBody,
    },
    deleteBusinessService: {
      params: businessServiceIdParams,
    },
  },
};
