const mongoose = require("mongoose");
const Appointment = require("../models/appointment");
const CashSession = require("../models/cashSession");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const Refund = require("../models/refund");
const { resolveBusinessOrReply } = require("./commerceShared");
const { recordDomainEvent } = require("../services/domainEventService");
const { buildCommercePaymentFilter } = require("../services/payment/paymentScope");
const { buildCashSessionSnapshot } = require("../services/payment/cashSessionSummary");
const {
  COMMERCE_REPORTING_SCOPE,
} = require("../services/payment/reportingScope");
const {
  buildServiceLineSnapshotList,
} = require("../services/checkout/serviceLineService");
const {
  buildServiceRevenueBreakdown,
} = require("../services/payment/serviceRevenueBreakdown");
const {
  buildStaffRevenueBreakdown,
} = require("../services/payment/staffRevenueBreakdown");
const {
  buildRebookingSummary,
} = require("../services/payment/rebookingSummary");
const {
  buildFinancialReconciliation,
} = require("../services/payment/financialReconciliation");
const {
  syncClientLifecycleAfterPayment,
} = require("../services/client/lifecycleService");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

const PAYMENT_READ_SORT = { capturedAt: 1, _id: 1 };
const REFUND_READ_SORT = { refundedAt: 1, _id: 1 };
const CHECKOUT_READ_SORT = { openedAt: 1, _id: 1 };

const toMoneyNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const hasMoneyValue = (value) =>
  value !== undefined && value !== null && value !== "";

const getCheckoutTotalizationMoney = (checkout, fieldName, fallback = 0) => {
  const value = checkout.totalization?.[fieldName];
  return toMoneyNumber(hasMoneyValue(value) ? value : fallback);
};

const buildPaymentSnapshot = (checkout) => ({
  subtotal: toMoneyNumber(checkout.subtotal),
  discountTotal: toMoneyNumber(checkout.discountTotal),
  total: toMoneyNumber(checkout.total),
  sourcePrice: toMoneyNumber(checkout.sourcePrice),
  service: {
    id: checkout.snapshot?.service?.id || null,
    name: checkout.snapshot?.service?.name || "",
  },
  serviceLines: buildServiceLineSnapshotList(checkout.serviceLines || []),
  productLines: checkout.productLines || [],
  discountLines: checkout.discountLines || [],
  taxLines: checkout.taxLines || [],
  totalization: {
    serviceSubtotal: getCheckoutTotalizationMoney(
      checkout,
      "serviceSubtotal",
      checkout.subtotal
    ),
    productSubtotal: getCheckoutTotalizationMoney(checkout, "productSubtotal"),
    subtotal: getCheckoutTotalizationMoney(
      checkout,
      "subtotal",
      checkout.subtotal
    ),
    discountTotal: getCheckoutTotalizationMoney(
      checkout,
      "discountTotal",
      checkout.discountTotal
    ),
    taxableSubtotal: getCheckoutTotalizationMoney(
      checkout,
      "taxableSubtotal",
      Math.max(
        toMoneyNumber(checkout.subtotal) - toMoneyNumber(checkout.discountTotal),
        0
      )
    ),
    taxTotal: getCheckoutTotalizationMoney(checkout, "taxTotal"),
    tipTotal: getCheckoutTotalizationMoney(checkout, "tipTotal", checkout.tip),
    totalBeforeDeposit: getCheckoutTotalizationMoney(
      checkout,
      "totalBeforeDeposit",
      checkout.total
    ),
    depositAppliedTotal: getCheckoutTotalizationMoney(
      checkout,
      "depositAppliedTotal"
    ),
    amountDue: getCheckoutTotalizationMoney(
      checkout,
      "amountDue",
      checkout.total
    ),
    refundTotal: getCheckoutTotalizationMoney(
      checkout,
      "refundTotal",
      checkout.refundSummary?.refundedTotal
    ),
  },
  client: {
    id: checkout.snapshot?.client?.id || null,
    firstName: checkout.snapshot?.client?.firstName || "",
    lastName: checkout.snapshot?.client?.lastName || "",
  },
  discounts: {
    promotionAmount:
      Number(checkout.snapshot?.discounts?.promotion?.amount) || 0,
    flashSaleAmount:
      Number(checkout.snapshot?.discounts?.flashSale?.amount) || 0,
  },
});

const applyPaymentPopulate = (query) =>
  query
    .populate("cashSession")
    .populate("checkout")
    .populate("appointment")
    .populate("client", "firstName lastName phone")
    .populate("staff", "firstName lastName")
    .populate("capturedBy", "name email");

const applyRefundPopulate = (query) =>
  query
    .populate("payment")
    .populate("checkout")
    .populate("appointment")
    .populate("client", "firstName lastName phone")
    .populate("staff", "firstName lastName")
    .populate("refundedBy", "name email");

const hydratePayment = (paymentId) => applyPaymentPopulate(Payment.findById(paymentId));

const hydrateRefund = (refundId) => applyRefundPopulate(Refund.findById(refundId));

const getOwnedPayment = (paymentId, businessId) =>
  Payment.findOne(buildCommercePaymentFilter({
    _id: paymentId,
    business: businessId,
  }));

const getOwnedPaymentOrReply = async (
  req,
  res,
  businessId,
  paymentId,
  { hydrate = false } = {}
) => {
  const paymentQuery = getOwnedPayment(paymentId, businessId);
  const payment = hydrate
    ? await applyPaymentPopulate(paymentQuery)
    : await paymentQuery;

  if (!payment) {
    ErrorHandler("Payment not found", 404, req, res);
    return null;
  }

  return payment;
};

const getBusinessAndOwnedPayment = async (
  req,
  res,
  { hydrate = false } = {}
) => {
  const business = await resolveBusinessOrReply(req, res);
  if (!business) {
    return {};
  }

  const payment = await getOwnedPaymentOrReply(
    req,
    res,
    business._id,
    req.params.id,
    { hydrate }
  );

  return { business, payment };
};

const getRefundStatus = (paymentAmount, refundedTotal) =>
  refundedTotal === paymentAmount ? "full" : "partial";

const REFUNDABLE_PAYMENT_STATUSES = ["captured", "refunded_partial"];

const createControllerError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const withOptionalSession = (query, mongoSession) =>
  mongoSession ? query.session(mongoSession) : query;

const getRefundIdempotencyKey = (req) => {
  const rawKey = req.get?.("Idempotency-Key") || req.body?.idempotencyKey || "";
  return String(rawKey).trim();
};

const getCaptureIdempotencyKey = (req) => {
  const rawKey = req.get?.("Idempotency-Key") || req.body?.idempotencyKey || "";
  return String(rawKey).trim();
};

const CAPTURE_PAYMENT_METHODS = ["cash", "card_manual", "other", "stripe"];
const MAX_CAPTURE_IDEMPOTENCY_KEY_LENGTH = 128;

const amountsMatch = (left, right) =>
  Math.abs((Number(left) || 0) - (Number(right) || 0)) < 0.000001;

const isSameCaptureShape = (payment, { checkoutId, amount, method }) =>
  String(payment.checkout) === String(checkoutId) &&
  amountsMatch(payment.amount, amount) &&
  payment.method === method;

const findIdempotentCapture = (businessId, idempotencyKey, mongoSession) => {
  if (!idempotencyKey) {
    return null;
  }

  return withOptionalSession(
    Payment.findOne(buildCommercePaymentFilter({
      business: businessId,
      idempotencyKey,
    })),
    mongoSession
  );
};

const findIdempotentRefund = (paymentId, businessId, idempotencyKey, mongoSession) => {
  if (!idempotencyKey) {
    return null;
  }

  return withOptionalSession(
    Refund.findOne({
      payment: paymentId,
      business: businessId,
      idempotencyKey,
    }),
    mongoSession
  );
};

const buildDateRangeFilter = (fieldName, startDate, endDate) => {
  const range = {};
  if (startDate) {
    range.$gte = new Date(startDate);
  }
  if (endDate) {
    range.$lte = new Date(endDate);
  }

  return Object.keys(range).length > 0 ? { [fieldName]: range } : {};
};

const recalculateCashSessionSummary = async (
  cashSessionId,
  { mongoSession = null } = {}
) => {
  const cashSession = await withOptionalSession(
    CashSession.findById(cashSessionId),
    mongoSession
  );
  if (!cashSession || cashSession.status !== "open") {
    return cashSession;
  }

  const cashPayments = await withOptionalSession(
    Payment.find({
      cashSession: cashSession._id,
      method: "cash",
      status: { $in: ["captured", "refunded_partial", "refunded_full"] },
      ...buildCommercePaymentFilter(),
    }),
    mongoSession
  );

  const snapshot = buildCashSessionSnapshot(cashSession, cashPayments);

  cashSession.payments = snapshot.paymentIds;
  cashSession.closingExpected = snapshot.closingExpected;
  cashSession.summary = snapshot.summary;
  cashSession.variance = snapshot.variance;

  await cashSession.save(mongoSession ? { session: mongoSession } : undefined);
  return cashSession;
};

const capturePayment = async (req, res) => {
  let businessForIdempotency = null;
  let checkoutForIdempotency = null;
  let normalizedAmount = null;
  let captureMethod = "";
  let idempotencyKey = "";

  try {
    const business = await resolveBusinessOrReply(req, res);
    if (!business) return;

    businessForIdempotency = business;

    const { amount, reference = "" } = req.body;
    captureMethod = String(req.body.method || "").trim();
    idempotencyKey = getCaptureIdempotencyKey(req);

    const checkout = await Checkout.findOne({
      _id: req.params.checkoutId,
      business: business._id,
    });

    if (!checkout) {
      return ErrorHandler("Checkout not found", 404, req, res);
    }

    checkoutForIdempotency = checkout;

    if (idempotencyKey.length > MAX_CAPTURE_IDEMPOTENCY_KEY_LENGTH) {
      return ErrorHandler(
        "Idempotency key must be 128 characters or fewer",
        400,
        req,
        res
      );
    }

    if (!CAPTURE_PAYMENT_METHODS.includes(captureMethod)) {
      return ErrorHandler("Payment method is not supported", 400, req, res);
    }

    normalizedAmount = Number(amount);
    if (Number.isNaN(normalizedAmount) || normalizedAmount < 0) {
      return ErrorHandler("Amount must be a non-negative number", 400, req, res);
    }

    if (!amountsMatch(normalizedAmount, Number(checkout.total))) {
      return ErrorHandler(
        "Payment amount must match checkout total",
        400,
        req,
        res
      );
    }

    const existingIdempotentPayment = await findIdempotentCapture(
      business._id,
      idempotencyKey
    );

    if (existingIdempotentPayment) {
      if (
        !isSameCaptureShape(existingIdempotentPayment, {
          checkoutId: checkout._id,
          amount: normalizedAmount,
          method: captureMethod,
        })
      ) {
        return ErrorHandler(
          "Idempotency key already used for a different payment capture",
          409,
          req,
          res
        );
      }

      const hydratedExistingPayment = await hydratePayment(
        existingIdempotentPayment._id
      );
      return SuccessHandler(hydratedExistingPayment, 200, res);
    }

    const existingPayment = await Payment.findOne({
      checkout: checkout._id,
      status: { $in: ["captured", "refunded_partial", "refunded_full"] },
      ...buildCommercePaymentFilter(),
    });

    if (existingPayment) {
      return ErrorHandler(
        "A terminal payment already exists for this checkout",
        409,
        req,
        res
      );
    }

    if (checkout.status !== "closed") {
      return ErrorHandler(
        "Checkout must be closed before capturing payment",
        409,
        req,
        res
      );
    }

    let activeCashSession = null;
    if (captureMethod === "cash") {
      activeCashSession = await CashSession.findOne({
        business: business._id,
        status: "open",
      });

      if (!activeCashSession) {
        return ErrorHandler(
          "An active cash session is required to capture cash payments",
          409,
          req,
          res
        );
      }
    }

    const paymentPayload = {
      paymentScope: "commerce_checkout",
      checkout: checkout._id,
      appointment: checkout.appointment,
      business: checkout.business,
      client: checkout.client,
      staff: checkout.staff,
      cashSession: activeCashSession?._id || null,
      status: "captured",
      method: captureMethod,
      currency: checkout.currency,
      amount: normalizedAmount,
      tip: Number(checkout.tip) || 0,
      reference,
      capturedAt: new Date(),
      capturedBy: req.user._id,
      snapshot: buildPaymentSnapshot(checkout),
    };

    if (idempotencyKey) {
      paymentPayload.idempotencyKey = idempotencyKey;
    }

    const payment = await Payment.create(paymentPayload);

    checkout.status = "paid";
    await checkout.save();

    await Appointment.findByIdAndUpdate(checkout.appointment, {
      paymentStatus: "Paid",
    });
    await recordDomainEvent({
      type: "payment_captured",
      actorId: req.user._id || req.user.id,
      shopId: business._id,
      correlationId: checkout._id,
      payload: {
        paymentId: payment._id,
        checkoutId: checkout._id,
        appointmentId: checkout.appointment,
        method: captureMethod,
        amount: normalizedAmount,
        tip: Number(checkout.tip) || 0,
        idempotencyKeyPresent: Boolean(idempotencyKey),
      },
    });
    await syncClientLifecycleAfterPayment(payment);

    const hydratedPayment = await hydratePayment(payment._id);

    return SuccessHandler(hydratedPayment, 201, res);
  } catch (error) {
    if (
      error?.code === 11000 &&
      idempotencyKey &&
      businessForIdempotency &&
      checkoutForIdempotency
    ) {
      const existingIdempotentPayment = await findIdempotentCapture(
        businessForIdempotency._id,
        idempotencyKey
      );

      if (
        existingIdempotentPayment &&
        isSameCaptureShape(existingIdempotentPayment, {
          checkoutId: checkoutForIdempotency._id,
          amount: normalizedAmount,
          method: captureMethod,
        })
      ) {
        const hydratedExistingPayment = await hydratePayment(
          existingIdempotentPayment._id
        );
        return SuccessHandler(hydratedExistingPayment, 200, res);
      }

      return ErrorHandler(
        "Idempotency key already used for a different payment capture",
        409,
        req,
        res
      );
    }

    if (error?.code === 11000) {
      return ErrorHandler(
        "A terminal payment already exists for this checkout",
        409,
        req,
        res
      );
    }

    return ErrorHandler(error.message, 500, req, res);
  }
};

const getPaymentById = async (req, res) => {
  try {
    const { payment } = await getBusinessAndOwnedPayment(req, res, {
      hydrate: true,
    });
    if (!payment) return;

    return SuccessHandler(payment, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const getPaymentByCheckout = async (req, res) => {
  try {
    const business = await resolveBusinessOrReply(req, res);
    if (!business) return;

    const payment = await applyPaymentPopulate(Payment.findOne({
      checkout: req.params.checkoutId,
      business: business._id,
      ...buildCommercePaymentFilter(),
    }))
      .sort({ createdAt: -1 });

    if (!payment) {
      return ErrorHandler("Payment not found", 404, req, res);
    }

    return SuccessHandler(payment, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const refundPayment = async (req, res) => {
  let paymentForIdempotency = null;
  let businessForIdempotency = null;
  let normalizedAmount = null;
  let idempotencyKey = "";

  try {
    const { business, payment } = await getBusinessAndOwnedPayment(req, res);
    if (!payment) return;

    businessForIdempotency = business;
    paymentForIdempotency = payment;

    normalizedAmount = Number(req.body.amount);
    if (Number.isNaN(normalizedAmount) || normalizedAmount <= 0) {
      return ErrorHandler(
        "Refund amount must be greater than zero",
        400,
        req,
        res
      );
    }

    idempotencyKey = getRefundIdempotencyKey(req);

    let refund = null;
    let refundWasCreated = false;
    let domainEvent = null;
    let lifecyclePaymentId = null;

    const mongoSession = await mongoose.startSession();
    try {
      await mongoSession.withTransaction(async () => {
        const existingRefund = await findIdempotentRefund(
          payment._id,
          business._id,
          idempotencyKey,
          mongoSession
        );

        if (existingRefund) {
          if (!amountsMatch(existingRefund.amount, normalizedAmount)) {
            throw createControllerError(
              "Idempotency key already used for a different refund amount",
              409
            );
          }

          refund = existingRefund;
          refundWasCreated = false;
          return;
        }

        const currentPayment = await Payment.findOne(
          buildCommercePaymentFilter({
            _id: payment._id,
            business: business._id,
          })
        ).session(mongoSession);

        if (!currentPayment) {
          throw createControllerError("Payment not found", 404);
        }

        if (!REFUNDABLE_PAYMENT_STATUSES.includes(currentPayment.status)) {
          throw createControllerError("Only captured payments can be refunded", 409);
        }

        const refundedTotal = Number(currentPayment.refundedTotal) || 0;
        const remainingAmount = Number(currentPayment.amount) - refundedTotal;
        if (normalizedAmount > remainingAmount) {
          throw createControllerError(
            "Refund amount exceeds captured payment amount",
            409
          );
        }

        if (currentPayment.method === "cash" && currentPayment.cashSession) {
          const cashSession = await CashSession.findById(
            currentPayment.cashSession
          ).session(mongoSession);

          if (cashSession && cashSession.status !== "open") {
            throw createControllerError(
              "Cash payments from a closed cash session cannot be refunded",
              409
            );
          }
        }

        const refundPayload = {
          payment: currentPayment._id,
          checkout: currentPayment.checkout,
          appointment: currentPayment.appointment,
          business: currentPayment.business,
          client: currentPayment.client,
          staff: currentPayment.staff,
          amount: normalizedAmount,
          currency: currentPayment.currency,
          reason: req.body.reason || "",
          refundedAt: new Date(),
          refundedBy: req.user._id,
        };

        if (idempotencyKey) {
          refundPayload.idempotencyKey = idempotencyKey;
        }

        [refund] = await Refund.create([refundPayload], {
          session: mongoSession,
        });
        refundWasCreated = true;

        const newRefundedTotal = refundedTotal + normalizedAmount;
        const refundStatus = getRefundStatus(
          Number(currentPayment.amount),
          newRefundedTotal
        );

        currentPayment.refundedTotal = newRefundedTotal;
        currentPayment.status =
          refundStatus === "full" ? "refunded_full" : "refunded_partial";
        await currentPayment.save({ session: mongoSession });
        lifecyclePaymentId = currentPayment._id;

        const checkout = await Checkout.findById(currentPayment.checkout).session(
          mongoSession
        );
        if (checkout) {
          checkout.refundSummary = {
            refundedTotal: newRefundedTotal,
            status: refundStatus,
          };

          if (refundStatus === "full") {
            checkout.status = "closed";
          }

          await checkout.save({ session: mongoSession });
        }

        await Appointment.findByIdAndUpdate(
          currentPayment.appointment,
          {
            paymentStatus:
              refundStatus === "full" ? "Refunded" : "Partially Refunded",
          },
          { session: mongoSession }
        );

        if (currentPayment.method === "cash" && currentPayment.cashSession) {
          await recalculateCashSessionSummary(currentPayment.cashSession, {
            mongoSession,
          });
        }

        domainEvent = {
          type: "payment_refunded",
          actorId: req.user._id || req.user.id,
          shopId: currentPayment.business,
          correlationId: currentPayment.checkout,
          payload: {
            refundId: refund._id,
            paymentId: currentPayment._id,
            checkoutId: currentPayment.checkout,
            appointmentId: currentPayment.appointment,
            amount: normalizedAmount,
            refundedTotal: newRefundedTotal,
            refundStatus,
          },
        };
      });
    } finally {
      await mongoSession.endSession();
    }

    if (!refundWasCreated) {
      const hydratedExistingRefund = await hydrateRefund(refund._id);
      return SuccessHandler(hydratedExistingRefund, 200, res);
    }

    await recordDomainEvent(domainEvent);
    if (lifecyclePaymentId) {
      const lifecyclePayment = await Payment.findById(lifecyclePaymentId);
      await syncClientLifecycleAfterPayment(lifecyclePayment);
    }

    const hydratedRefund = await hydrateRefund(refund._id);
    return SuccessHandler(hydratedRefund, 201, res);
  } catch (error) {
    if (
      error?.code === 11000 &&
      idempotencyKey &&
      paymentForIdempotency &&
      businessForIdempotency
    ) {
      const existingRefund = await findIdempotentRefund(
        paymentForIdempotency._id,
        businessForIdempotency._id,
        idempotencyKey
      );

      if (existingRefund && amountsMatch(existingRefund.amount, normalizedAmount)) {
        const hydratedExistingRefund = await hydrateRefund(existingRefund._id);
        return SuccessHandler(hydratedExistingRefund, 200, res);
      }

      return ErrorHandler(
        "Idempotency key already used for a different refund amount",
        409,
        req,
        res
      );
    }

    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

const voidPayment = async (req, res) => {
  try {
    const { payment } = await getBusinessAndOwnedPayment(req, res);
    if (!payment) return;

    const previousVoidedPayment = await Payment.findOne({
      checkout: payment.checkout,
      status: "voided",
      _id: { $ne: payment._id },
      ...buildCommercePaymentFilter(),
    }).select("_id");
    if (previousVoidedPayment) {
      return ErrorHandler(
        "This checkout already used its void correction cycle",
        409,
        req,
        res
      );
    }

    const refundCount = await Refund.countDocuments({ payment: payment._id });
    if (refundCount > 0 || Number(payment.refundedTotal) > 0) {
      return ErrorHandler(
        "Payments with refunds cannot be voided",
        409,
        req,
        res
      );
    }

    if (payment.status !== "captured") {
      return ErrorHandler("Only captured payments can be voided", 409, req, res);
    }

    if (payment.method === "cash" && payment.cashSession) {
      const cashSession = await CashSession.findById(payment.cashSession);

      if (cashSession && cashSession.status !== "open") {
        return ErrorHandler(
          "Cash payments from a closed cash session cannot be voided",
          409,
          req,
          res
        );
      }
    }

    payment.status = "voided";
    payment.voidedAt = new Date();
    payment.voidedBy = req.user._id;
    payment.voidReason = req.body.reason || "";
    await payment.save();

    const checkout = await Checkout.findById(payment.checkout);
    if (checkout) {
      checkout.status = "closed";
      await checkout.save();
    }

    await Appointment.findByIdAndUpdate(payment.appointment, {
      paymentStatus: "Pending",
    });

    if (payment.method === "cash" && payment.cashSession) {
      await recalculateCashSessionSummary(payment.cashSession);
    }
    await recordDomainEvent({
      type: "payment_voided",
      actorId: req.user._id || req.user.id,
      shopId: payment.business,
      correlationId: payment.checkout,
      payload: {
        paymentId: payment._id,
        checkoutId: payment.checkout,
        appointmentId: payment.appointment,
        method: payment.method,
        amount: Number(payment.amount) || 0,
        reason: payment.voidReason || "",
      },
    });
    await syncClientLifecycleAfterPayment(payment);

    const hydratedPayment = await hydratePayment(payment._id);
    return SuccessHandler(hydratedPayment, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const getRefundsByPayment = async (req, res) => {
  try {
    const { business, payment } = await getBusinessAndOwnedPayment(req, res);
    if (!payment) return;

    const refunds = await applyRefundPopulate(Refund.find({
      payment: payment._id,
      business: business._id,
    }))
      .sort({ refundedAt: -1 });

    return SuccessHandler(refunds, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const getPaymentSummary = async (req, res) => {
  try {
    const business = await resolveBusinessOrReply(req, res);
    if (!business) return;

    const { startDate, endDate } = req.query;
    const paymentDateFilter = buildDateRangeFilter("capturedAt", startDate, endDate);
    const refundDateFilter = buildDateRangeFilter("refundedAt", startDate, endDate);
    const checkoutDateFilter = buildDateRangeFilter("openedAt", startDate, endDate);

    const capturedStatuses = ["captured", "refunded_partial", "refunded_full"];

    const [payments, refunds, checkouts] = await Promise.all([
      Payment.find({
        business: business._id,
        ...paymentDateFilter,
        ...buildCommercePaymentFilter(),
      })
        .sort(PAYMENT_READ_SORT)
        .lean(),
      Refund.find({
        business: business._id,
        ...refundDateFilter,
      })
        .sort(REFUND_READ_SORT)
        .lean(),
      Checkout.find({
        business: business._id,
        ...checkoutDateFilter,
      })
        .sort(CHECKOUT_READ_SORT)
        .lean(),
    ]);

    const checkoutIds = checkouts.map((checkout) => checkout._id);
    const capturedPaymentsForCheckouts = checkoutIds.length > 0
      ? await Payment.find({
          business: business._id,
          checkout: { $in: checkoutIds },
          status: { $in: capturedStatuses },
          ...buildCommercePaymentFilter(),
        })
          .select("checkout status")
          .lean()
      : [];

    const rebookingSummary = buildRebookingSummary(
      checkouts,
      capturedPaymentsForCheckouts
    );

    const grossCaptured = payments
      .filter((payment) => capturedStatuses.includes(payment.status))
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);

    const voidedTotal = payments
      .filter((payment) => payment.status === "voided")
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);

    const refundedTotal = refunds.reduce(
      (sum, refund) => sum + (Number(refund.amount) || 0),
      0
    );

    const methodBreakdown = payments
      .filter((payment) => capturedStatuses.includes(payment.status))
      .reduce(
        (acc, payment) => {
          const method = payment.method || "other";
          acc[method] = (acc[method] || 0) + (Number(payment.amount) || 0);
          return acc;
        },
        { cash: 0, card_manual: 0, other: 0 }
      );

    const retainedPayments = payments.filter((payment) =>
      capturedStatuses.includes(payment.status)
    );

    const summary = {
      moneyScope: COMMERCE_REPORTING_SCOPE,
      grossCaptured,
      refundedTotal,
      netCaptured: grossCaptured - refundedTotal,
      voidedTotal,
      transactionCount: retainedPayments.length,
      capturedCount: payments.filter((payment) => payment.status === "captured").length,
      refundedPartialCount: payments.filter(
        (payment) => payment.status === "refunded_partial"
      ).length,
      refundedFullCount: payments.filter(
        (payment) => payment.status === "refunded_full"
      ).length,
      voidedCount: payments.filter((payment) => payment.status === "voided").length,
      methodBreakdown,
      serviceBreakdown: buildServiceRevenueBreakdown(payments),
      staffBreakdown: buildStaffRevenueBreakdown(payments),
      rebooking: rebookingSummary,
    };

    return SuccessHandler(summary, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const getPaymentReconciliation = async (req, res) => {
  try {
    const business = await resolveBusinessOrReply(req, res);
    if (!business) return;

    const reconciliation = await buildFinancialReconciliation({
      businessId: business._id,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    return SuccessHandler(reconciliation, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

module.exports = {
  capturePayment,
  getPaymentById,
  getPaymentByCheckout,
  refundPayment,
  voidPayment,
  getRefundsByPayment,
  getPaymentSummary,
  getPaymentReconciliation,
};
