const CashSession = require("../../models/cashSession");
const Checkout = require("../../models/checkout");
const Payment = require("../../models/payment");
const { roundMoney } = require("../checkout/totalizationService");
const { buildCashSessionSnapshot } = require("./cashSessionSummary");
const {
  COMMERCE_REPORTING_SCOPE,
} = require("./reportingScope");
const {
  PAYMENT_PROVIDER,
  buildCommercePaymentFilter,
} = require("./paymentScope");

const RETAINED_PAYMENT_STATUSES = [
  "captured",
  "refunded_partial",
  "refunded_full",
];

const CASH_SESSION_PAYMENT_STATUSES = [
  "captured",
  "refunded_partial",
  "refunded_full",
];

const PAYMENT_STATUSES_WITH_CHECKOUT_STATUS = [
  ...RETAINED_PAYMENT_STATUSES,
  "voided",
];

const toMoney = (value) => roundMoney(Number(value) || 0);

const moneyMatches = (left, right) => toMoney(left) === toMoney(right);

const toId = (value) => {
  if (!value) return "";
  return String(value._id || value);
};

const parseOptionalDate = (value, fieldName) => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${fieldName} must be a valid date`);
    error.statusCode = 400;
    throw error;
  }

  return date;
};

const buildDateRangeFilter = (fieldName, startDate, endDate) => {
  const range = {};
  if (startDate) {
    range.$gte = startDate;
  }
  if (endDate) {
    range.$lte = endDate;
  }

  return Object.keys(range).length > 0 ? { [fieldName]: range } : {};
};

const getCheckoutAmountDue = (checkout) => {
  const amountDue = Number(checkout?.totalization?.amountDue);
  const legacyTotal = Number(checkout?.total);

  if (Number.isFinite(amountDue) && amountDue > 0) {
    return toMoney(amountDue);
  }

  return toMoney(legacyTotal);
};

const createIssueCollector = () => {
  const issues = [];

  const addIssue = ({
    code,
    severity = "medium",
    entityType,
    entityId,
    message,
    context = {},
  }) => {
    issues.push({
      code,
      severity,
      entityType,
      entityId: toId(entityId),
      message,
      context,
    });
  };

  return { issues, addIssue };
};

const mapById = (items) =>
  new Map(items.map((item) => [toId(item._id), item]));

const getCheckoutStatusExpectedForPayment = (payment) => {
  if (payment.status === "voided" || payment.status === "refunded_full") {
    return "closed";
  }
  return "paid";
};

const reconcilePaymentAgainstCheckout = (payment, checkoutMap, addIssue) => {
  const checkout = checkoutMap.get(toId(payment.checkout));

  if (!checkout) {
    addIssue({
      code: "payment_missing_checkout",
      severity: "high",
      entityType: "payment",
      entityId: payment._id,
      message: "Payment references a checkout that does not exist in this business.",
      context: {
        checkoutId: toId(payment.checkout),
        paymentStatus: payment.status,
        amount: toMoney(payment.amount),
      },
    });
    return;
  }

  const expectedAmount = getCheckoutAmountDue(checkout);
  if (!moneyMatches(payment.amount, expectedAmount)) {
    addIssue({
      code: "payment_checkout_amount_mismatch",
      severity: "high",
      entityType: "payment",
      entityId: payment._id,
      message: "Payment amount does not match checkout amount due.",
      context: {
        checkoutId: toId(checkout._id),
        paymentAmount: toMoney(payment.amount),
        checkoutAmountDue: expectedAmount,
      },
    });
  }

  if (payment.currency !== checkout.currency) {
    addIssue({
      code: "payment_checkout_currency_mismatch",
      severity: "high",
      entityType: "payment",
      entityId: payment._id,
      message: "Payment currency does not match checkout currency.",
      context: {
        checkoutId: toId(checkout._id),
        paymentCurrency: payment.currency,
        checkoutCurrency: checkout.currency,
      },
    });
  }

  if (PAYMENT_STATUSES_WITH_CHECKOUT_STATUS.includes(payment.status)) {
    const expectedStatus = getCheckoutStatusExpectedForPayment(payment);
    if (checkout.status !== expectedStatus) {
      addIssue({
        code: "payment_checkout_status_mismatch",
        severity: "medium",
        entityType: "payment",
        entityId: payment._id,
        message: "Payment status and checkout status are not aligned.",
        context: {
          checkoutId: toId(checkout._id),
          paymentStatus: payment.status,
          checkoutStatus: checkout.status,
          expectedCheckoutStatus: expectedStatus,
        },
      });
    }
  }
};

const reconcilePaidCheckouts = (checkouts, payments, addIssue) => {
  const retainedCheckoutIds = new Set(
    payments
      .filter((payment) => RETAINED_PAYMENT_STATUSES.includes(payment.status))
      .map((payment) => toId(payment.checkout))
      .filter(Boolean)
  );

  checkouts
    .filter((checkout) => checkout.status === "paid")
    .forEach((checkout) => {
      if (!retainedCheckoutIds.has(toId(checkout._id))) {
        addIssue({
          code: "paid_checkout_missing_retained_payment",
          severity: "high",
          entityType: "checkout",
          entityId: checkout._id,
          message: "Checkout is marked as paid but has no retained commerce payment.",
          context: {
            checkoutStatus: checkout.status,
            checkoutAmountDue: getCheckoutAmountDue(checkout),
          },
        });
      }
    });
};

const findRetainedPaymentsForCheckouts = async (businessId, checkouts) => {
  const checkoutIds = [
    ...new Set(checkouts.map((checkout) => toId(checkout._id)).filter(Boolean)),
  ];

  if (checkoutIds.length === 0) {
    return [];
  }

  return Payment.find({
    business: businessId,
    checkout: { $in: checkoutIds },
    status: { $in: RETAINED_PAYMENT_STATUSES },
    ...buildCommercePaymentFilter(),
  }).lean();
};

const reconcileProviderReference = (payment, addIssue) => {
  if (
    payment.provider === PAYMENT_PROVIDER.STRIPE &&
    RETAINED_PAYMENT_STATUSES.includes(payment.status) &&
    !payment.providerReference
  ) {
    addIssue({
      code: "stripe_payment_missing_provider_reference",
      severity: "medium",
      entityType: "payment",
      entityId: payment._id,
      message: "Stripe payment is missing provider reference.",
      context: {
        paymentStatus: payment.status,
        method: payment.method,
        provider: payment.provider,
      },
    });
  }
};

const reconcileCashPayment = (payment, addIssue) => {
  if (
    payment.method === "cash" &&
    RETAINED_PAYMENT_STATUSES.includes(payment.status) &&
    !payment.cashSession
  ) {
    addIssue({
      code: "cash_payment_missing_cash_session",
      severity: "high",
      entityType: "payment",
      entityId: payment._id,
      message: "Cash payment is retained but is not linked to a cash session.",
      context: {
        paymentStatus: payment.status,
        amount: toMoney(payment.amount),
      },
    });
  }
};

const compareCashSessionNumber = ({
  cashSession,
  snapshot,
  storedValue,
  expectedValue,
  field,
  addIssue,
}) => {
  if (moneyMatches(storedValue, expectedValue)) {
    return;
  }

  addIssue({
    code: "cash_session_summary_mismatch",
    severity: "medium",
    entityType: "cash_session",
    entityId: cashSession._id,
    message: "Cash session stored summary does not match retained cash payments.",
    context: {
      field,
      storedValue: toMoney(storedValue),
      expectedValue: toMoney(expectedValue),
      transactionCount: snapshot.summary.transactionCount,
    },
  });
};

const compareCashSessionCount = ({
  cashSession,
  snapshot,
  storedValue,
  expectedValue,
  field,
  addIssue,
}) => {
  if (Number(storedValue) === Number(expectedValue)) {
    return;
  }

  addIssue({
    code: "cash_session_summary_mismatch",
    severity: "medium",
    entityType: "cash_session",
    entityId: cashSession._id,
    message: "Cash session stored summary does not match retained cash payments.",
    context: {
      field,
      storedValue: Number(storedValue) || 0,
      expectedValue: Number(expectedValue) || 0,
      cashSalesTotal: toMoney(snapshot.summary.cashSalesTotal),
    },
  });
};

const reconcileCashSessions = (cashSessions, cashPayments, addIssue) => {
  const cashPaymentsBySession = cashPayments.reduce((acc, payment) => {
    const sessionId = toId(payment.cashSession);
    if (!sessionId) {
      return acc;
    }

    if (!acc.has(sessionId)) {
      acc.set(sessionId, []);
    }
    acc.get(sessionId).push(payment);
    return acc;
  }, new Map());

  cashSessions.forEach((cashSession) => {
    if (cashSession.status !== "closed") {
      return;
    }

    const sessionPayments = cashPaymentsBySession.get(toId(cashSession._id)) || [];
    const snapshot = buildCashSessionSnapshot(cashSession, sessionPayments);

    compareCashSessionNumber({
      cashSession,
      snapshot,
      storedValue: cashSession.summary?.cashSalesTotal,
      expectedValue: snapshot.summary.cashSalesTotal,
      field: "summary.cashSalesTotal",
      addIssue,
    });
    compareCashSessionNumber({
      cashSession,
      snapshot,
      storedValue: cashSession.summary?.tipsTotal,
      expectedValue: snapshot.summary.tipsTotal,
      field: "summary.tipsTotal",
      addIssue,
    });
    compareCashSessionCount({
      cashSession,
      snapshot,
      storedValue: cashSession.summary?.transactionCount,
      expectedValue: snapshot.summary.transactionCount,
      field: "summary.transactionCount",
      addIssue,
    });
    compareCashSessionNumber({
      cashSession,
      snapshot,
      storedValue: cashSession.summary?.expectedDrawerTotal,
      expectedValue: snapshot.summary.expectedDrawerTotal,
      field: "summary.expectedDrawerTotal",
      addIssue,
    });
    compareCashSessionNumber({
      cashSession,
      snapshot,
      storedValue: cashSession.closingExpected,
      expectedValue: snapshot.closingExpected,
      field: "closingExpected",
      addIssue,
    });
  });
};

const countBySeverity = (issues) =>
  issues.reduce((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] || 0) + 1;
    return acc;
  }, {});

const buildFinancialReconciliation = async ({
  businessId,
  startDate: rawStartDate,
  endDate: rawEndDate,
}) => {
  const startDate = parseOptionalDate(rawStartDate, "startDate");
  const endDate = parseOptionalDate(rawEndDate, "endDate");
  if (startDate && endDate && startDate > endDate) {
    const error = new Error("startDate must be before endDate");
    error.statusCode = 400;
    throw error;
  }

  const paymentDateFilter = buildDateRangeFilter("capturedAt", startDate, endDate);
  const checkoutDateFilter = buildDateRangeFilter("openedAt", startDate, endDate);
  const cashSessionDateFilter = buildDateRangeFilter(
    "openedAt",
    startDate,
    endDate
  );

  const payments = await Payment.find({
    business: businessId,
    ...paymentDateFilter,
    ...buildCommercePaymentFilter(),
  }).lean();

  const checkoutsInRange = await Checkout.find({
    business: businessId,
    ...checkoutDateFilter,
  }).lean();

  const linkedCheckoutIds = [
    ...new Set(payments.map((payment) => toId(payment.checkout)).filter(Boolean)),
  ];
  const linkedCheckouts = linkedCheckoutIds.length
    ? await Checkout.find({
        _id: { $in: linkedCheckoutIds },
        business: businessId,
      }).lean()
    : [];

  const checkouts = [
    ...mapById([...checkoutsInRange, ...linkedCheckouts]).values(),
  ];
  const retainedPaymentsForCheckouts = await findRetainedPaymentsForCheckouts(
    businessId,
    checkouts
  );

  const cashSessionsInRange = await CashSession.find({
    business: businessId,
    ...cashSessionDateFilter,
  }).lean();

  const cashSessionIds = [
    ...new Set(
      [
        ...cashSessionsInRange.map((cashSession) => toId(cashSession._id)),
        ...payments.map((payment) => toId(payment.cashSession)).filter(Boolean),
      ].filter(Boolean)
    ),
  ];
  const cashSessions = cashSessionIds.length
    ? await CashSession.find({
        _id: { $in: cashSessionIds },
        business: businessId,
      }).lean()
    : [];

  const cashPayments = cashSessionIds.length
    ? await Payment.find({
        business: businessId,
        cashSession: { $in: cashSessionIds },
        method: "cash",
        status: { $in: CASH_SESSION_PAYMENT_STATUSES },
        ...buildCommercePaymentFilter(),
      }).lean()
    : [];

  const checkoutMap = mapById(checkouts);
  const { issues, addIssue } = createIssueCollector();

  payments.forEach((payment) => {
    reconcilePaymentAgainstCheckout(payment, checkoutMap, addIssue);
    reconcileCashPayment(payment, addIssue);
    reconcileProviderReference(payment, addIssue);
  });
  reconcilePaidCheckouts(
    checkouts,
    [...payments, ...retainedPaymentsForCheckouts],
    addIssue
  );
  reconcileCashSessions(cashSessions, cashPayments, addIssue);

  return {
    moneyScope: COMMERCE_REPORTING_SCOPE,
    status: issues.length > 0 ? "attention_required" : "clean",
    period: {
      startDate: startDate ? startDate.toISOString() : null,
      endDate: endDate ? endDate.toISOString() : null,
    },
    summary: {
      checkedAt: new Date().toISOString(),
      paymentCount: payments.length,
      checkoutCount: checkouts.length,
      cashSessionCount: cashSessions.length,
      issueCount: issues.length,
      issuesBySeverity: countBySeverity(issues),
    },
    issues,
  };
};

module.exports = {
  buildFinancialReconciliation,
};
