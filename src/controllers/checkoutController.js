const Appointment = require("../models/appointment");
const Business = require("../models/User/business");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const Service = require("../models/service");
const Staff = require("../models/staff");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const { recordDomainEvent } = require("../services/domainEventService");
const {
  findCapacityConflict,
  runWithCapacityGuard,
} = require("../services/appointment/capacityGuard");
const moment = require("moment");
const mongoose = require("mongoose");

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

const buildRebookingDateTime = (date, startTime) => {
  const appointmentDateTime = new Date(date);
  appointmentDateTime.setHours(parseInt(startTime.split(":")[0], 10));
  appointmentDateTime.setMinutes(parseInt(startTime.split(":")[1], 10));
  appointmentDateTime.setSeconds(0, 0);
  return appointmentDateTime;
};

const getRebookingEndTime = (startTime, duration) => {
  return moment(startTime, "HH:mm").add(duration, "minutes").format("HH:mm");
};

const staffSupportsService = (staffDoc, serviceId) => {
  if (!staffDoc || !Array.isArray(staffDoc.services)) {
    return false;
  }

  return staffDoc.services.some(({ service }) => {
    if (!service) return false;
    return service.toString() === serviceId.toString();
  });
};

const toValidatedObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
};

const hasTerminalRefund = (checkout) =>
  Boolean(checkout?.refundSummary?.status) &&
  checkout.refundSummary.status !== "none";

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

    const isCompletedVisit =
      appointment.status === "Completed" &&
      appointment.visitStatus === "completed";
    if (!isCompletedVisit) {
      return ErrorHandler(
        "Checkout can only be opened for a completed visit",
        409,
        req,
        res
      );
    }

    const existingOpenCheckout = await Checkout.findOne({
      appointment: appointment._id,
      status: "open",
    });

    if (existingOpenCheckout) {
      return ErrorHandler("An open checkout already exists for this appointment", 409, req, res);
    }

    const existingTerminalCheckout = await Checkout.findOne({
      appointment: appointment._id,
      status: { $in: ["closed", "paid"] },
    }).select("_id status refundSummary");

    if (existingTerminalCheckout) {
      return ErrorHandler(
        "A terminal checkout already exists for this appointment",
        409,
        req,
        res
      );
    }

    const checkout = await Checkout.create(buildCheckoutPayload(appointment));
    await recordDomainEvent({
      type: "checkout_opened",
      actorId: req.user._id || req.user.id,
      shopId: business._id,
      correlationId: checkout._id,
      payload: {
        checkoutId: checkout._id,
        appointmentId: appointment._id,
        clientId: checkout.client,
        staffId: checkout.staff,
        total: checkout.total,
      },
    });
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
      .populate("rebooking.appointment")
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
      .populate("rebooking.appointment")
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

    if (checkout.status !== "open") {
      return ErrorHandler("Checkout is already finalized", 409, req, res);
    }

    checkout.tip = tip;
    checkout.total = Number(checkout.subtotal) + tip;
    checkout.status = "closed";
    checkout.closedAt = new Date();
    checkout.closedBy = req.user._id;

    await checkout.save();
    await recordDomainEvent({
      type: "checkout_closed",
      actorId: req.user._id || req.user.id,
      shopId: business._id,
      correlationId: checkout._id,
      payload: {
        checkoutId: checkout._id,
        appointmentId: checkout.appointment,
        clientId: checkout.client,
        staffId: checkout.staff,
        tip: checkout.tip,
        total: checkout.total,
      },
    });

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

const createRebooking = async (req, res) => {
  try {
    const business = await getBusinessForOwner(req.user.id);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const { date, startTime, serviceId, staffId } = req.body;
    if (!date || !startTime) {
      return ErrorHandler("Date and startTime are required", 400, req, res);
    }

    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime)) {
      return ErrorHandler(
        "Invalid start time format. Use HH:MM format",
        400,
        req,
        res
      );
    }

    const checkout = await Checkout.findOne({
      _id: req.params.id,
      business: business._id,
    }).populate("appointment");

    if (!checkout) {
      return ErrorHandler("Checkout not found", 404, req, res);
    }

    if (hasTerminalRefund(checkout)) {
      return ErrorHandler(
        "Rebooking is not allowed after a refunded checkout",
        409,
        req,
        res
      );
    }

    if (checkout.status !== "paid") {
      return ErrorHandler(
        "Checkout must be paid before creating a rebooking",
        409,
        req,
        res
      );
    }

    if (checkout.rebooking?.status === "booked" && checkout.rebooking?.appointment) {
      return ErrorHandler(
        "A rebooking already exists for this checkout",
        409,
        req,
        res
      );
    }

    const sourceAppointment = checkout.appointment;
    if (!sourceAppointment) {
      return ErrorHandler("Source appointment not found", 404, req, res);
    }

    const sourceVisitCompleted =
      sourceAppointment.status === "Completed" &&
      sourceAppointment.visitStatus === "completed";
    if (!sourceVisitCompleted) {
      return ErrorHandler(
        "Source appointment must be completed before creating a rebooking",
        409,
        req,
        res
      );
    }

    const capturedPayment = await Payment.findOne({
      checkout: checkout._id,
      status: "captured",
      paymentScope: "commerce_checkout",
    }).select("_id");
    if (!capturedPayment) {
      return ErrorHandler(
        "Checkout requires a captured payment before creating a rebooking",
        409,
        req,
        res
      );
    }

    const targetServiceId = serviceId
      ? toValidatedObjectId(serviceId)
      : toValidatedObjectId(sourceAppointment.service);
    if (!targetServiceId) {
      return ErrorHandler("Invalid serviceId", 400, req, res);
    }

    const service = await Service.findOne({
      _id: { $eq: targetServiceId },
      business: { $eq: business._id },
      isActive: { $eq: true },
    });
    if (!service) {
      return ErrorHandler("Service not found for rebooking", 404, req, res);
    }

    const targetStaffId = staffId
      ? toValidatedObjectId(staffId)
      : toValidatedObjectId(sourceAppointment.staff);
    if (!targetStaffId) {
      return ErrorHandler(
        staffId
          ? "Invalid staffId"
          : "Rebooking requires a staff member on the source appointment",
        400,
        req,
        res
      );
    }

    const staff = await Staff.findOne({
      _id: { $eq: targetStaffId },
      business: { $eq: business._id },
    });
    if (!staff) {
      return ErrorHandler("Staff not found for rebooking", 404, req, res);
    }

    if (!staffSupportsService(staff, service._id)) {
      return ErrorHandler(
        "Selected staff member does not provide this service",
        400,
        req,
        res
      );
    }

    const duration = Number(sourceAppointment.duration) || Number(service.duration) || 0;
    const targetDuration = Number(service.duration) || duration;
    if (targetDuration <= 0) {
      return ErrorHandler(
        "Rebooking requires a valid appointment duration",
        400,
        req,
        res
      );
    }

    const appointmentDateTime = buildRebookingDateTime(date, startTime);
    const now = new Date();
    now.setSeconds(0, 0);
    if (appointmentDateTime <= now) {
      return ErrorHandler(
        "Cannot create a rebooking in the past",
        400,
        req,
        res
      );
    }

    const endTime = getRebookingEndTime(startTime, targetDuration);
    const capacityConflictMessage =
      "This staff member is not available at the selected time";
    const targetDate = moment(date, "YYYY-MM-DD").startOf("day").toDate();
    const conflictingAppointment = await findCapacityConflict({
      businessId: business._id,
      staffId: staff._id,
      date: targetDate,
      startTime,
      endTime,
    });

    if (conflictingAppointment) {
      return ErrorHandler(capacityConflictMessage, 409, req, res);
    }

    const rebookedAppointment = await runWithCapacityGuard({
      businessId: business._id,
      staffId: staff._id,
      date: targetDate,
      startTime,
      endTime,
      conflictMessage: capacityConflictMessage,
      operation: async ({ session }) => {
        const checkoutForUpdate = await Checkout.findOne({
          _id: checkout._id,
          business: business._id,
        }).session(session);

        if (!checkoutForUpdate) {
          const error = new Error("Checkout not found");
          error.statusCode = 404;
          throw error;
        }

        if (hasTerminalRefund(checkoutForUpdate)) {
          const error = new Error(
            "Rebooking is not allowed after a refunded checkout"
          );
          error.statusCode = 409;
          throw error;
        }

        if (checkoutForUpdate.status !== "paid") {
          const error = new Error(
            "Checkout must be paid before creating a rebooking"
          );
          error.statusCode = 409;
          throw error;
        }

        if (
          checkoutForUpdate?.rebooking?.status === "booked" &&
          checkoutForUpdate?.rebooking?.appointment
        ) {
          const error = new Error("A rebooking already exists for this checkout");
          error.statusCode = 409;
          throw error;
        }

        const capturedPaymentForUpdate = await Payment.findOne({
          checkout: checkoutForUpdate._id,
          status: "captured",
          paymentScope: "commerce_checkout",
        })
          .select("_id")
          .session(session);
        if (!capturedPaymentForUpdate) {
          const error = new Error(
            "Checkout requires a captured payment before creating a rebooking"
          );
          error.statusCode = 409;
          throw error;
        }

        const [createdAppointment] = await Appointment.create(
          [
            {
              client: sourceAppointment.client,
              business: sourceAppointment.business,
              service: service._id,
              staff: staff._id,
              date: targetDate,
              startTime,
              endTime,
              duration: targetDuration,
              status: "Confirmed",
              bookingStatus: "booked",
              visitStatus: "not_started",
              visitType: "appointment",
              paymentStatus: "Pending",
              price: Number(service.price) || 0,
              notes: sourceAppointment.notes || "",
              clientNotes: sourceAppointment.clientNotes || "",
              promotion: {
                applied: false,
                promotionId: null,
                originalPrice: 0,
                discountAmount: 0,
                discountPercentage: 0,
              },
              flashSale: {
                applied: false,
                flashSaleId: null,
                originalPrice: 0,
                discountAmount: 0,
                discountPercentage: 0,
              },
              rebookingOrigin: {
                checkout: checkout._id,
                appointment: sourceAppointment._id,
                createdAt: new Date(),
                createdBy: req.user._id || req.user.id,
              },
              policySnapshot: Appointment.buildPolicySnapshot(business),
            },
          ],
          { session }
        );

        checkoutForUpdate.rebooking = {
          status: "booked",
          appointment: createdAppointment._id,
          service: service._id,
          staff: staff._id,
          createdAt: new Date(),
          createdBy: req.user._id || req.user.id,
        };
        await checkoutForUpdate.save({ session });

        return createdAppointment;
      },
    });
    await recordDomainEvent({
      type: "rebook_created",
      actorId: req.user._id || req.user.id,
      shopId: business._id,
      correlationId: checkout._id,
      payload: {
        checkoutId: checkout._id,
        sourceAppointmentId: sourceAppointment._id,
        appointmentId: rebookedAppointment._id,
        clientId: rebookedAppointment.client,
        serviceId: rebookedAppointment.service,
        staffId: rebookedAppointment.staff,
        date,
        startTime,
      },
    });

    const hydratedAppointment = await Appointment.findById(rebookedAppointment._id)
      .populate("service", "name price currency")
      .populate("client", "firstName lastName phone")
      .populate("staff", "firstName lastName");

    return SuccessHandler(hydratedAppointment, 201, res);
  } catch (error) {
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

module.exports = {
  openCheckout,
  getCheckoutById,
  getCheckoutByAppointment,
  closeCheckout,
  createRebooking,
};
