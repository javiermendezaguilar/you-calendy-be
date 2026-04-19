const Appointment = require("../models/appointment");
const CashSession = require("../models/cashSession");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const Refund = require("../models/refund");
const { resolveBusinessOrReply } = require("./commerceShared");
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

const hydratePayment = (paymentId) =>
  Payment.findById(paymentId)
    .populate("cashSession")
    .populate("checkout")
    .populate("appointment")
    .populate("client", "firstName lastName phone")
    .populate("staff", "firstName lastName")
    .populate("capturedBy", "name email");

const hydrateRefund = (refundId) =>
  Refund.findById(refundId)
    .populate("payment")
    .populate("checkout")
    .populate("appointment")
    .populate("client", "firstName lastName phone")
    .populate("staff", "firstName lastName")
    .populate("refundedBy", "name email");

const getOwnedPayment = (paymentId, businessId) =>
  Payment.findOne({
    _id: paymentId,
    business: businessId,
  });

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
    const business = await resolveBusinessOrReply(req, res);
    if (!business) return;

    const payment = await getOwnedPayment(req.params.id, business._id)
      .populate("cashSession")
      .populate("checkout")
      .populate("appointment")
      .populate("client", "firstName lastName phone")
      .populate("staff", "firstName lastName")
      .populate("capturedBy", "name email");

    if (!payment) {
      return ErrorHandler("Payment not found", 404, req, res);
    }

    return SuccessHandler(payment, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const getPaymentByCheckout = async (req, res) => {
  try {
    const business = await resolveBusinessOrReply(req, res);
    if (!business) return;

    const payment = await Payment.findOne({
      checkout: req.params.checkoutId,
      business: business._id,
    })
      .sort({ createdAt: -1 })
      .populate("cashSession")
      .populate("checkout")
      .populate("appointment")
      .populate("client", "firstName lastName phone")
      .populate("staff", "firstName lastName")
      .populate("capturedBy", "name email");

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
    const business = await resolveBusinessOrReply(req, res);
    if (!business) return;

    const payment = await getOwnedPayment(req.params.id, business._id);

    if (!payment) {
      return ErrorHandler("Payment not found", 404, req, res);
    }

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
    payment.refundedTotal = newRefundedTotal;
    payment.status =
      newRefundedTotal === Number(payment.amount)
        ? "refunded_full"
        : "refunded_partial";
    await payment.save();

    const checkout = await Checkout.findById(payment.checkout);
    if (checkout) {
      checkout.refundSummary = {
        refundedTotal: newRefundedTotal,
        status:
          newRefundedTotal === Number(payment.amount) ? "full" : "partial",
      };
      await checkout.save();
    }

    if (newRefundedTotal === Number(payment.amount)) {
      await Appointment.findByIdAndUpdate(payment.appointment, {
        paymentStatus: "Refunded",
      });
    }

    const hydratedRefund = await hydrateRefund(refund._id);
    return SuccessHandler(hydratedRefund, 201, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const getRefundsByPayment = async (req, res) => {
  try {
    const business = await resolveBusinessOrReply(req, res);
    if (!business) return;

    const payment = await getOwnedPayment(req.params.id, business._id);

    if (!payment) {
      return ErrorHandler("Payment not found", 404, req, res);
    }

    const refunds = await Refund.find({
      payment: payment._id,
      business: business._id,
    })
      .sort({ refundedAt: -1 })
      .populate("payment")
      .populate("checkout")
      .populate("appointment")
      .populate("client", "firstName lastName phone")
      .populate("staff", "firstName lastName")
      .populate("refundedBy", "name email");

    return SuccessHandler(refunds, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  capturePayment,
  getPaymentById,
  getPaymentByCheckout,
  refundPayment,
  getRefundsByPayment,
};
