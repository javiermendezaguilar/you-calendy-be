const Appointment = require("../models/appointment");
const Business = require("../models/User/business");
const Client = require("../models/client");
const PolicyCharge = require("../models/policyCharge");
const {
  createPolicyChargeIntent,
  POLICY_CHARGE_TYPES,
} = require("../services/payment/policyChargeService");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

const getActorId = (req) => req.user?._id || req.user?.id;

const getIdempotencyKey = (req) =>
  String(req.get?.("Idempotency-Key") || req.body?.idempotencyKey || "").trim();

const isClientActor = (req) =>
  req.user?.role === "client" || req.user?.type === "client";

const getPolicyChargeContext = async (req, res) => {
  const appointment = await Appointment.findById(req.params.id).populate("service");
  if (!appointment) {
    ErrorHandler("Appointment not found", 404, req, res);
    return {};
  }

  const [business, client] = await Promise.all([
    Business.findById(appointment.business),
    Client.findById(appointment.client),
  ]);

  if (!business) {
    ErrorHandler("Business not found", 404, req, res);
    return {};
  }

  if (!client) {
    ErrorHandler("Client not found", 404, req, res);
    return {};
  }

  const actorId = getActorId(req);
  const isBusinessOwner = String(business.owner) === String(actorId);
  const isAppointmentClient =
    isClientActor(req) && String(appointment.client) === String(actorId);

  if (!isBusinessOwner && !isAppointmentClient) {
    ErrorHandler("Not authorized to manage policy charges for this appointment", 403, req, res);
    return {};
  }

  return {
    appointment,
    business,
    client,
    actorId,
    isBusinessOwner,
    isAppointmentClient,
  };
};

const assertPolicyChargePermission = ({ type, isBusinessOwner, isAppointmentClient }) => {
  if (type === POLICY_CHARGE_TYPES.DEPOSIT && (isBusinessOwner || isAppointmentClient)) {
    return;
  }

  if (
    [POLICY_CHARGE_TYPES.NO_SHOW_FEE, POLICY_CHARGE_TYPES.LATE_CANCEL_FEE].includes(type) &&
    isBusinessOwner
  ) {
    return;
  }

  const error = new Error("Not authorized to create this policy charge");
  error.statusCode = 403;
  throw error;
};

const createPolicyCharge = async (req, res) => {
  try {
    const {
      appointment,
      business,
      client,
      actorId,
      isBusinessOwner,
      isAppointmentClient,
    } = await getPolicyChargeContext(req, res);
    if (!appointment) return;

    const type = String(req.body?.type || "").trim();
    assertPolicyChargePermission({
      type,
      isBusinessOwner,
      isAppointmentClient,
    });

    const result = await createPolicyChargeIntent({
      appointment,
      business,
      client,
      actorId,
      type,
      idempotencyKey: getIdempotencyKey(req),
      requestedAmount: req.body?.amount,
      saveCardOnFile: req.body?.saveCardOnFile === true,
    });

    return SuccessHandler(
      result.policyCharge,
      result.created ? 201 : 200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

const getAppointmentPolicyCharges = async (req, res) => {
  try {
    const { appointment, business } = await getPolicyChargeContext(req, res);
    if (!appointment) return;

    const charges = await PolicyCharge.find({
      appointment: appointment._id,
      business: business._id,
    })
      .sort({ createdAt: -1 })
      .populate("payment")
      .lean();

    return SuccessHandler(charges, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

module.exports = {
  createPolicyCharge,
  getAppointmentPolicyCharges,
};
