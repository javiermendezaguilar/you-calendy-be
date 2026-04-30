const {
  booleanInput,
  clientIdParams,
  dateOnly,
  idParams,
  numberInput,
  objectId,
  optionalBoolean,
  optionalIntegerRange,
  optionalString,
  positiveMoney,
  requiredString,
  toUndefinedIfBlank,
  z,
} = require("./requestSchemaPrimitives");

const optionalEmailAddress = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string" && value.trim() === "") return undefined;
    return typeof value === "string" ? value.trim().toLowerCase() : value;
  },
  z.string().email().max(320).optional()
);

const optionalDateFilter = z.preprocess(
  toUndefinedIfBlank,
  dateOnly.optional()
);

const optionalEnum = (values) =>
  z.preprocess(toUndefinedIfBlank, z.enum(values).optional());

const nonEmptyOptionalString = (maxLength) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null) return undefined;
      return String(value).trim();
    },
    z.string().min(1).max(maxLength).optional()
  );

const confirmTrue = booleanInput(z.literal(true));

const paginationQuery = {
  page: optionalIntegerRange(1, 100000),
  limit: optionalIntegerRange(1, 100),
};

const adminStatsYearQuery = z
  .object({
    year: optionalIntegerRange(2000, 2100),
  })
  .passthrough();

const revenueProjectionQuery = z
  .object({
    startDate: optionalDateFilter,
    endDate: optionalDateFilter,
    groupBy: optionalEnum(["day", "month", "year"]),
  })
  .passthrough();

const sendEmailBody = z
  .object({
    recipientGroup: z.enum(["all", "barbers", "clients"]),
    message: requiredString(10000),
  })
  .strict();

const clientProfileBody = z
  .object({
    firstName: nonEmptyOptionalString(120),
    lastName: nonEmptyOptionalString(120),
    email: optionalEmailAddress,
    phone: nonEmptyOptionalString(60),
    profileImage: optionalString(2048),
    notes: optionalString(4000),
    privateNotes: optionalString(4000),
    notificationsEnabled: optionalBoolean,
    status: optionalEnum(["activated", "deactivated"]),
    isActive: optionalBoolean,
    registrationStatus: optionalEnum([
      "unregistered",
      "pending",
      "registered",
    ]),
    hasAcceptedTerms: optionalBoolean,
  })
  .strict();

const clientStatusBody = z
  .object({
    status: z.enum(["activated", "deactivated"]),
  })
  .strict();

const auditLogQuery = z
  .object({
    ...paginationQuery,
    search: optionalString(200),
    entityType: optionalEnum([
      "Staff",
      "Client",
      "Business",
      "Service",
      "Appointment",
      "Other",
    ]),
    action: optionalEnum(["deleted", "updated", "created", "modified", "other"]),
    startDate: optionalDateFilter,
    endDate: optionalDateFilter,
  })
  .passthrough();

const logIdParams = z.object({ logId: objectId }).strict();

const backupListQuery = z
  .object({
    ...paginationQuery,
    type: optionalEnum(["daily", "weekly", "monthly"]),
    status: optionalEnum(["completed", "failed", "in_progress"]),
  })
  .passthrough();

const backupCreateBody = z
  .object({
    type: z.enum(["daily", "weekly", "monthly"]),
    format: optionalEnum(["json", "compressed"]),
  })
  .strict();

const backupRestoreBody = z
  .object({
    confirm: confirmTrue,
  })
  .strict();

const backupCleanupBody = z
  .object({
    maxAgeInDays: optionalIntegerRange(1, 3650),
  })
  .strict();

const apiKeysBody = z
  .object({
    googleAnalyticsApiKey: nonEmptyOptionalString(1024),
    nodemailerApiKey: nonEmptyOptionalString(1024),
    metadata: z.object({}).passthrough().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.googleAnalyticsApiKey && !value.nodemailerApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["googleAnalyticsApiKey"],
        message:
          "or nodemailerApiKey is required to update platform API keys",
      });
    }
  });

const featureList = z.array(requiredString(200)).min(1).max(100);
const optionalFeatureList = z.array(requiredString(200)).min(1).max(100).optional();
const optionalFeatureKeys = z.array(requiredString(120)).max(100).optional();
const planLimits = z.object({}).passthrough().optional();
const currency = optionalEnum(["usd", "eur", "gbp", "cad", "aud"]);
const billingInterval = optionalEnum(["month", "year", "week", "day"]);

const createPlanBody = z
  .object({
    title: requiredString(160),
    description: requiredString(2000),
    amount: positiveMoney,
    features: featureList,
    featureKeys: optionalFeatureKeys,
    limits: planLimits,
    currency,
    billingInterval,
  })
  .passthrough();

const updatePlanBody = z
  .object({
    title: nonEmptyOptionalString(160),
    description: nonEmptyOptionalString(2000),
    amount: numberInput(z.number().finite().positive().optional()),
    features: optionalFeatureList,
    featureKeys: optionalFeatureKeys,
    limits: planLimits,
    isActive: optionalBoolean,
  })
  .passthrough();

module.exports = {
  adminInputSchemas: {
    sendEmail: {
      body: sendEmailBody,
    },
    clientProfile: {
      params: clientIdParams,
      body: clientProfileBody,
    },
    clientStatus: {
      params: clientIdParams,
      body: clientStatusBody,
    },
    clientById: {
      params: clientIdParams,
    },
    auditLogs: {
      query: auditLogQuery,
    },
    auditLogById: {
      params: logIdParams,
    },
    backupList: {
      query: backupListQuery,
    },
    backupCreate: {
      body: backupCreateBody,
    },
    backupById: {
      params: idParams,
    },
    backupRestore: {
      params: idParams,
      body: backupRestoreBody,
    },
    backupUploadRestore: {
      body: backupRestoreBody,
    },
    backupCleanup: {
      body: backupCleanupBody,
    },
    adminStatsYear: {
      query: adminStatsYearQuery,
    },
    revenueProjection: {
      query: revenueProjectionQuery,
    },
    apiKeys: {
      body: apiKeysBody,
    },
    planById: {
      params: idParams,
    },
    createPlan: {
      body: createPlanBody,
    },
    updatePlan: {
      params: idParams,
      body: updatePlanBody,
    },
    deletePlan: {
      params: idParams,
    },
  },
};
