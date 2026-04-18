const Appointment = require("../models/appointment");
const Business = require("../models/User/business");
const Checkout = require("../models/checkout");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

const getBusinessForOwner = async (ownerId) => {
  return Business.findOne({ owner: ownerId });
};

const getAppointmentDiscountTotal = (appointment) => {
  const promotionDiscount = Number(appointment?.promotion?.discountAmount) || 0;
  const flashSaleDiscount = Number(appointment?.flashSale?.discountAmount) || 0;

  return promotionDiscount + flashSaleDiscount;
};

const getAppointmentSourcePrice = (appointment) => {
  if (appointment?.promotion?.applied && appointment?.promotion?.originalPrice) {
    return Number(appointment.promotion.originalPrice) || 0;
  }

  if (appointment?.flashSale?.applied && appointment?.flashSale?.originalPrice) {
    return Number(appointment.flashSale.originalPrice) || 0;
  }

  return Number(appointment?.price) || 0;
};

const buildCheckoutSnapshot = (appointment) => ({
  appointmentStatus: appointment.status || "",
  bookingStatus: appointment.bookingStatus || "",
  visitStatus: appointment.visitStatus || "",
  service: {
    id: appointment.service?._id || appointment.service || null,
    name: appointment.service?.name || "",
  },
  client: {
    id: appointment.client?._id || appointment.client || null,
    firstName: appointment.client?.firstName || "",
    lastName: appointment.client?.lastName || "",
    phone: appointment.client?.phone || "",
  },
  staff: {
    id: appointment.staff?._id || appointment.staff || null,
    firstName: appointment.staff?.firstName || "",
    lastName: appointment.staff?.lastName || "",
  },
  discounts: {
    promotion: {
      applied: appointment?.promotion?.applied === true,
      id: appointment?.promotion?.promotionId || null,
      amount: Number(appointment?.promotion?.discountAmount) || 0,
    },
    flashSale: {
      applied: appointment?.flashSale?.applied === true,
      id: appointment?.flashSale?.flashSaleId || null,
      amount: Number(appointment?.flashSale?.discountAmount) || 0,
    },
  },
});

const buildCheckoutPayload = (appointment) => {
  const subtotal = Number(appointment.price) || 0;
  const discountTotal = getAppointmentDiscountTotal(appointment);
  const sourcePrice = getAppointmentSourcePrice(appointment);

  return {
    appointment: appointment._id,
    business: appointment.business,
    client: appointment.client?._id || appointment.client,
    staff: appointment.staff?._id || appointment.staff || null,
    currency: appointment.service?.currency || "USD",
    subtotal,
    discountTotal,
    tip: 0,
    total: subtotal,
    sourcePrice,
    snapshot: buildCheckoutSnapshot(appointment),
  };
};

const openCheckout = async (req, res) => {
  try {
    const business = await getBusinessForOwner(req.user.id);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const appointment = await Appointment.findOne({
      _id: req.params.appointmentId,
      business: business._id,
    })
      .populate("service", "name currency")
      .populate("client", "firstName lastName phone")
      .populate("staff", "firstName lastName");

    if (!appointment) {
      return ErrorHandler("Appointment not found", 404, req, res);
    }

    const existingOpenCheckout = await Checkout.findOne({
      appointment: appointment._id,
      status: "open",
    });

    if (existingOpenCheckout) {
      return ErrorHandler("An open checkout already exists for this appointment", 409, req, res);
    }

    const checkout = await Checkout.create(buildCheckoutPayload(appointment));
    const hydratedCheckout = await Checkout.findById(checkout._id)
      .populate("appointment")
      .populate("client", "firstName lastName phone")
      .populate("staff", "firstName lastName");

    return SuccessHandler(hydratedCheckout, 201, res);
  } catch (error) {
    if (error?.code === 11000) {
      return ErrorHandler("An open checkout already exists for this appointment", 409, req, res);
    }

    return ErrorHandler(error.message, 500, req, res);
  }
};

const getCheckoutById = async (req, res) => {
  try {
    const business = await getBusinessForOwner(req.user.id);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const checkout = await Checkout.findOne({
      _id: req.params.id,
      business: business._id,
    })
      .populate("appointment")
      .populate("client", "firstName lastName phone")
      .populate("staff", "firstName lastName")
      .populate("closedBy", "name email");

    if (!checkout) {
      return ErrorHandler("Checkout not found", 404, req, res);
    }

    return SuccessHandler(checkout, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const getCheckoutByAppointment = async (req, res) => {
  try {
    const business = await getBusinessForOwner(req.user.id);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const checkout = await Checkout.findOne({
      appointment: req.params.appointmentId,
      business: business._id,
    })
      .sort({ createdAt: -1 })
      .populate("appointment")
      .populate("client", "firstName lastName phone")
      .populate("staff", "firstName lastName")
      .populate("closedBy", "name email");

    if (!checkout) {
      return ErrorHandler("Checkout not found", 404, req, res);
    }

    return SuccessHandler(checkout, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const closeCheckout = async (req, res) => {
  try {
    const business = await getBusinessForOwner(req.user.id);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const tip = Number(req.body.tip ?? 0);
    if (Number.isNaN(tip) || tip < 0) {
      return ErrorHandler("Tip must be a non-negative number", 400, req, res);
    }

    const checkout = await Checkout.findOne({
      _id: req.params.id,
      business: business._id,
    });

    if (!checkout) {
      return ErrorHandler("Checkout not found", 404, req, res);
    }

    if (checkout.status === "closed") {
      return ErrorHandler("Checkout is already closed", 409, req, res);
    }

    checkout.tip = tip;
    checkout.total = Number(checkout.subtotal) + tip;
    checkout.status = "closed";
    checkout.closedAt = new Date();
    checkout.closedBy = req.user._id;

    await checkout.save();

    const hydratedCheckout = await Checkout.findById(checkout._id)
      .populate("appointment")
      .populate("client", "firstName lastName phone")
      .populate("staff", "firstName lastName")
      .populate("closedBy", "name email");

    return SuccessHandler(hydratedCheckout, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  openCheckout,
  getCheckoutById,
  getCheckoutByAppointment,
  closeCheckout,
};
