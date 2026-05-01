const {
  optionalIntegerMin,
  optionalIntegerRange,
  optionalString,
  z,
} = require("./requestSchemaPrimitives");

const listDomainEventsQuery = z
  .object({
    type: optionalString(80),
    limit: optionalIntegerRange(1, 100),
    page: optionalIntegerMin(1),
  })
  .passthrough();

module.exports = {
  domainEventInputSchemas: {
    listDomainEvents: {
      query: listDomainEventsQuery,
    },
  },
};
