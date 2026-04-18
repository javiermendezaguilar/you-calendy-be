const Appointment = require("../models/appointment");
const Business = require("../models/User/business");
const CashSession = require("../models/cashSession");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

const getBusinessForOwner = async (ownerId) => {
  return Business.findOne({ owner: ownerId });
};

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

const capturePayment = async (req, res) => {
  try {
    const business = await getBusinessForOwner(req.user.id);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

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

    const hydratedPayment = await Payment.findById(payment._id)
      .populate("cashSession")
      .populate("checkout")
      .populate("appointment")
      .populate("client", "firstName lastName phone")
      .populate("staff", "firstName lastName")
      .populate("capturedBy", "name email");

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
    const business = await getBusinessForOwner(req.user.id);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const payment = await Payment.findOne({
      _id: req.params.id,
      business: business._id,
    })
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
    const business = await getBusinessForOwner(req.user.id);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

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

module.exports = {
  capturePayment,
  getPaymentById,
  getPaymentByCheckout,
};
