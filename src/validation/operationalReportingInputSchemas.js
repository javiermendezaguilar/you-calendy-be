const {
  dateOnly,
  toUndefinedIfBlank,
  z,
} = require("./requestSchemaPrimitives");

const dateShortcut = z.preprocess(
  toUndefinedIfBlank,
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must use YYYY-MM-DD format")
    .optional()
);

const addQueryIssue = (ctx, path, message) => {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message,
  });
};

const operationalReportingQuery = z
  .object({
    date: dateShortcut,
    startDate: dateOnly.optional(),
    endDate: dateOnly.optional(),
  })
  .passthrough()
  .superRefine((query, ctx) => {
    if (query.date && (query.startDate || query.endDate)) {
      addQueryIssue(
        ctx,
        ["date"],
        "cannot be combined with startDate or endDate"
      );
    }

    if (!query.startDate || !query.endDate) {
      return;
    }

    const startTime = new Date(query.startDate).getTime();
    const endTime = new Date(query.endDate).getTime();

    if (startTime > endTime) {
      addQueryIssue(
        ctx,
        ["startDate"],
        "must be before or equal to endDate"
      );
    }
  });

module.exports = {
  operationalReportingInputSchemas: {
    operationalReporting: {
      query: operationalReportingQuery,
    },
  },
};
