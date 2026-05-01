const {
  optionalBoolean,
  optionalIntegerRange,
  optionalString,
  z,
} = require("./requestSchemaPrimitives");

const CLIENT_SORT_OPTIONS = [
  "firstName:asc",
  "firstName:desc",
  "lastName:asc",
  "lastName:desc",
  "email:asc",
  "email:desc",
  "phone:asc",
  "phone:desc",
  "createdAt:asc",
  "createdAt:desc",
];

const listClientsQuery = z
  .object({
    search: optionalString(120),
    sort: z.enum(CLIENT_SORT_OPTIONS).optional(),
    isActive: optionalBoolean,
    isProfileComplete: optionalBoolean,
    page: optionalIntegerRange(1, 100000),
    limit: optionalIntegerRange(1, 200),
    includeCount: optionalBoolean,
  })
  .passthrough();

module.exports = {
  clientInputSchemas: {
    listClients: {
      query: listClientsQuery,
    },
    countClients: {
      query: listClientsQuery,
    },
  },
};

