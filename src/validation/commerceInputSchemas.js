const {
  appointmentIdParams,
  checkoutIdParams,
  dateOnly,
  idParams,
  nonNegativeMoney,
  numberInput,
  objectId,
  optionalArray,
  optionalFiniteNumber,
  optionalIntegerMin,
  optionalIntegerRange,
  optionalNonNegativeMoney,
  optionalObjectId,
  optionalString,
  positiveMoney,
  timeOnly,
  z,
} = require("./requestSchemaPrimitives");

const moneyLine = z
  .object({
    label: optionalString(120),
    source: optionalString(40),
    amount: optionalNonNegativeMoney,
    rate: numberInput(z.number().finite().min(0).max(100).optional()),
    note: optionalString(500),
  })
  .passthrough();

const productLine = z
  .object({
    name: optionalString(120),
    quantity: optionalIntegerRange(1, 999),
    unitPrice: optionalNonNegativeMoney,
    adjustmentAmount: optionalFiniteNumber,
    source: optionalString(40),
    note: optionalString(500),
  })
  .passthrough();

const serviceLine = z
  .object({
    serviceId: objectId,
    staffId: optionalObjectId,
    quantity: optionalIntegerRange(1, 99),
    unitPrice: optionalNonNegativeMoney,
    durationMinutes: optionalIntegerRange(0, 1440),
    adjustmentAmount: optionalFiniteNumber,
    note: optionalString(500),
  })
  .passthrough();

const capturePaymentBody = z
  .object({
    amount: nonNegativeMoney,
    method: z.enum(["cash", "card_manual", "other", "stripe"]),
    reference: optionalString(200),
    idempotencyKey: optionalString(128),
  })
  .passthrough();

const refundPaymentBody = z
  .object({
    amount: positiveMoney,
    reason: optionalString(500),
    idempotencyKey: optionalString(128),
  })
  .passthrough();

const voidPaymentBody = z
  .object({
    reason: optionalString(500),
  })
  .passthrough();

const closeCheckoutBody = z
  .object({
    tip: optionalNonNegativeMoney,
    productLines: optionalArray(productLine, 50),
    discountLines: optionalArray(moneyLine, 50),
    taxLines: optionalArray(moneyLine, 50),
  })
  .passthrough();

const updateServiceLinesBody = z
  .object({
    serviceLines: z.array(serviceLine).min(1).max(20),
  })
  .passthrough();

const createRebookingBody = z
  .object({
    date: dateOnly,
    startTime: timeOnly,
    serviceId: optionalObjectId,
    staffId: optionalObjectId,
    source: z.enum(["checkout", "post_checkout", "manual_follow_up"]).optional(),
  })
  .passthrough();

const rebookingOutcomeBody = z
  .object({
    status: z.enum(["follow_up_needed", "declined"]),
    source: z.enum(["checkout", "post_checkout", "manual_follow_up"]).optional(),
    note: optionalString(500),
  })
  .passthrough();

const openCashSessionBody = z
  .object({
    openingFloat: nonNegativeMoney,
    openingReason: z
      .enum(["manual_start", "manual_adjustment", "handoff"])
      .optional(),
    openingNote: optionalString(500),
    handoffFromSessionId: optionalObjectId,
    currency: optionalString(10),
  })
  .passthrough();

const activeCashSessionQuery = z
  .object({
    closingDeclaredPreview: optionalNonNegativeMoney,
  })
  .passthrough();

const listCashSessionsQuery = z
  .object({
    status: z.enum(["open", "closed"]).optional(),
    limit: optionalIntegerMin(1),
  })
  .passthrough();

const cashSessionReportQuery = z
  .object({
    status: z.enum(["open", "closed", "all"]).optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  })
  .passthrough();

const closeCashSessionBody = z
  .object({
    closingDeclared: nonNegativeMoney,
    closingNote: optionalString(500),
  })
  .passthrough();

module.exports = {
  appointmentIdParams,
  checkoutIdParams,
  idParams,
  paymentInputSchemas: {
    capturePayment: {
      params: checkoutIdParams,
      body: capturePaymentBody,
    },
    refundPayment: {
      params: idParams,
      body: refundPaymentBody,
    },
    voidPayment: {
      params: idParams,
      body: voidPaymentBody,
    },
    checkoutIdRead: {
      params: checkoutIdParams,
    },
    paymentIdRead: {
      params: idParams,
    },
  },
  checkoutInputSchemas: {
    openCheckout: {
      params: appointmentIdParams,
    },
    checkoutByAppointment: {
      params: appointmentIdParams,
    },
    checkoutById: {
      params: idParams,
    },
    closeCheckout: {
      params: idParams,
      body: closeCheckoutBody,
    },
    updateServiceLines: {
      params: idParams,
      body: updateServiceLinesBody,
    },
    createRebooking: {
      params: idParams,
      body: createRebookingBody,
    },
    markRebookingOutcome: {
      params: idParams,
      body: rebookingOutcomeBody,
    },
  },
  cashSessionInputSchemas: {
    openCashSession: {
      body: openCashSessionBody,
    },
    activeCashSession: {
      query: activeCashSessionQuery,
    },
    listCashSessions: {
      query: listCashSessionsQuery,
    },
    cashSessionReport: {
      query: cashSessionReportQuery,
    },
    cashSessionById: {
      params: idParams,
    },
    closeCashSession: {
      params: idParams,
      body: closeCashSessionBody,
    },
  },
};
