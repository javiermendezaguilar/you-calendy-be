const Appointment = require("../models/appointment");
const CashSession = require("../models/cashSession");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const Refund = require("../models/refund");
const { resolveBusinessOrReply } = require("./commerceShared");
const { recordDomainEvent } = require("../services/domainEventService");
const { buildCommercePaymentFilter } = require("../services/payment/paymentScope");
const { buildCashSessionSnapshot } = require("../services/payment/cashSessionSummary");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

const buildPaymentSnapshot = (checkout) => ({
  subtotal: Number(checkout.subtotal) || 0,
  discountTotal: Number(checkout.discountTotal) || 0,
  total: Number(checkout.total) || 0,
  sourcePrice: Number(checkout.sourcePrice) || 0,
  service: {
    id: checkout.snapshot?.service?.id || null,
    name: checkout.snapshot?.service?.name || "",
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

const recalculateCashSessionSummary = async (cashSessionId) => {
  const cashSession = await CashSession.findById(cashSessionId);
  if (!cashSession || cashSession.status !== "open") {
    return cashSession;
  }

  const cashPayments = await Payment.find({
    cashSession: cashSession._id,
    method: "cash",
    status: { $in: ["captured", "refunded_partial", "refunded_full"] },
    ...buildCommercePaymentFilter(),
  });

  const snapshot = buildCashSessionSnapshot(cashSession, cashPayments);

  cashSession.payments = snapshot.paymentIds;
  cashSession.closingExpected = snapshot.closingExpected;
  cashSession.summary = snapshot.summary;
  cashSession.variance = snapshot.variance;

  await cashSession.save();
  return cashSession;
};

const capturePayment = async (req, res) => {
  try {
    const business = await resolveBusinessOrReply(req, res);
    if (!business) return;

    const { method, amount, reference = "" } = req.body;
    const checkout = await Checkout.findOne({
      _id: req.params.checkoutId,
      business: business._id,
    });

    if (!checkout) {
      return ErrorHandler("Checkout not found", 404, req, res);
    }

    const existingPayment = await Payment.findOne({
      checkout: checkout._id,
      status: "captured",
      ...buildCommercePaymentFilter(),
    });

    if (existingPayment) {
      return ErrorHandler(
        "A captured payment already exists for this checkout",
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

    const normalizedAmount = Number(amount);
    if (Number.isNaN(normalizedAmount) || normalizedAmount < 0) {
      return ErrorHandler("Amount must be a non-negative number", 400, req, res);
    }

    if (normalizedAmount !== Number(checkout.total)) {
      return ErrorHandler(
        "Payment amount must match checkout total",
        400,
        req,
        res
      );
    }

    let activeCashSession = null;
    if (method === "cash") {
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

    const payment = await Payment.create({
      paymentScope: "commerce_checkout",
      checkout: checkout._id,
      appointment: checkout.appointment,
      business: checkout.business,
      client: checkout.client,
      staff: checkout.staff,
      cashSession: activeCashSession?._id || null,
      status: "captured",
      method,
      currency: checkout.currency,
      amount: normalizedAmount,
      tip: Number(checkout.tip) || 0,
      reference,
      capturedAt: new Date(),
      capturedBy: req.user._id,
      snapshot: buildPaymentSnapshot(checkout),
    });

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
        method,
        amount: normalizedAmount,
        tip: Number(checkout.tip) || 0,
      },
    });

    const hydratedPayment = await hydratePayment(payment._id);

    return SuccessHandler(hydratedPayment, 201, res);
  } catch (error) {
    if (error?.code === 11000) {
      return ErrorHandler(
        "A captured payment already exists for this checkout",
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
  try {
    const { payment } = await getBusinessAndOwnedPayment(req, res);
    if (!payment) return;

    if (
      payment.status !== "captured" &&
      payment.status !== "refunded_partial"
    ) {
      return ErrorHandler(
        "Only captured payments can be refunded",
        409,
        req,
        res
      );
    }

    const normalizedAmount = Number(req.body.amount);
    if (Number.isNaN(normalizedAmount) || normalizedAmount <= 0) {
      return ErrorHandler(
        "Refund amount must be greater than zero",
        400,
        req,
        res
      );
    }

    const refundedTotal = Number(payment.refundedTotal) || 0;
    const remainingAmount = Number(payment.amount) - refundedTotal;
    if (normalizedAmount > remainingAmount) {
      return ErrorHandler(
        "Refund amount exceeds captured payment amount",
        409,
        req,
        res
      );
    }

    if (payment.method === "cash" && payment.cashSession) {
      const cashSession = await CashSession.findById(payment.cashSession);

      if (cashSession && cashSession.status !== "open") {
        return ErrorHandler(
          "Cash payments from a closed cash session cannot be refunded",
          409,
          req,
          res
        );
      }
    }

    const refund = await Refund.create({
      payment: payment._id,
      checkout: payment.checkout,
      appointment: payment.appointment,
      business: payment.business,
      client: payment.client,
      staff: payment.staff,
      amount: normalizedAmount,
      currency: payment.currency,
      reason: req.body.reason || "",
      refundedAt: new Date(),
      refundedBy: req.user._id,
    });

    const newRefundedTotal = refundedTotal + normalizedAmount;
    const refundStatus = getRefundStatus(Number(payment.amount), newRefundedTotal);
    payment.refundedTotal = newRefundedTotal;
    payment.status = refundStatus === "full" ? "refunded_full" : "refunded_partial";
    await payment.save();

    const checkout = await Checkout.findById(payment.checkout);
    if (checkout) {
      checkout.refundSummary = {
        refundedTotal: newRefundedTotal,
        status: refundStatus,
      };

      if (refundStatus === "full") {
        checkout.status = "closed";
      }

      await checkout.save();
    }

    await Appointment.findByIdAndUpdate(payment.appointment, {
      paymentStatus:
        refundStatus === "full" ? "Refunded" : "Partially Refunded",
    });

    if (payment.method === "cash" && payment.cashSession) {
      await recalculateCashSessionSummary(payment.cashSession);
    }

    await recordDomainEvent({
      type: "payment_refunded",
      actorId: req.user._id || req.user.id,
      shopId: payment.business,
      correlationId: payment.checkout,
      payload: {
        refundId: refund._id,
        paymentId: payment._id,
        checkoutId: payment.checkout,
        appointmentId: payment.appointment,
        amount: normalizedAmount,
        refundedTotal: newRefundedTotal,
        refundStatus,
      },
    });

    const hydratedRefund = await hydrateRefund(refund._id);
    return SuccessHandler(hydratedRefund, 201, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const voidPayment = async (req, res) => {
  try {
    const { payment } = await getBusinessAndOwnedPayment(req, res);
    if (!payment) return;

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

    const [payments, refunds, rebookingCount] = await Promise.all([
      Payment.find({
        business: business._id,
        ...paymentDateFilter,
        ...buildCommercePaymentFilter(),
      }).lean(),
      Refund.find({
        business: business._id,
        ...refundDateFilter,
      }).lean(),
      Checkout.countDocuments({
        business: business._id,
        "rebooking.status": "booked",
        ...checkoutDateFilter,
      }),
    ]);

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

    const summary = {
      grossCaptured,
      refundedTotal,
      netCaptured: grossCaptured - refundedTotal,
      voidedTotal,
      transactionCount: payments.length,
      capturedCount: payments.filter((payment) => payment.status === "captured").length,
      refundedPartialCount: payments.filter(
        (payment) => payment.status === "refunded_partial"
      ).length,
      refundedFullCount: payments.filter(
        (payment) => payment.status === "refunded_full"
      ).length,
      voidedCount: payments.filter((payment) => payment.status === "voided").length,
      methodBreakdown,
      rebooking: {
        count: rebookingCount,
      },
    };

    return SuccessHandler(summary, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
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
};
