const mongoose = require("mongoose");
const stripe = require("../billing/stripeClient");
const Appointment = require("../../models/appointment");
const Client = require("../../models/client");
const Payment = require("../../models/payment");
const PolicyCharge = require("../../models/policyCharge");
const { recordDomainEvent } = require("../domainEventService");
const {
  getEffectivePolicySnapshot,
} = require("../appointment/policyService");
const {
  PAYMENT_PROVIDER,
  PAYMENT_SCOPE,
  buildPolicyPaymentFilter,
} = require("./paymentScope");
const { stripePaymentProvider } = require("./providerAdapters");

const POLICY_CHARGE_STATUS = Object.freeze({
  PROCESSING: "processing",
  REQUIRES_PAYMENT_METHOD: "requires_payment_method",
  REQUIRES_CONFIRMATION: "requires_confirmation",
  REQUIRES_ACTION: "requires_action",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const POLICY_CHARGE_TYPES = Object.freeze({
  DEPOSIT: "deposit",
  NO_SHOW_FEE: "no_show_fee",
  LATE_CANCEL_FEE: "late_cancel_fee",
});

const ACTIVE_POLICY_CHARGE_STATUSES = [
  POLICY_CHARGE_STATUS.PROCESSING,
  POLICY_CHARGE_STATUS.REQUIRES_PAYMENT_METHOD,
  POLICY_CHARGE_STATUS.REQUIRES_CONFIRMATION,
  POLICY_CHARGE_STATUS.REQUIRES_ACTION,
  POLICY_CHARGE_STATUS.SUCCEEDED,
];

const createPolicyChargeError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeCurrency = stripePaymentProvider.normalizeCurrency;

const normalizeAmount = stripePaymentProvider.normalizeAmount;

const amountsMatch = (left, right) =>
  Math.abs(normalizeAmount(left) - normalizeAmount(right)) < 0.000001;

const fromMinorUnit = stripePaymentProvider.fromMinorUnit;

const normalizePolicyChargeType = (type) => {
  const normalized = String(type || "").trim();
  if (!Object.values(POLICY_CHARGE_TYPES).includes(normalized)) {
    throw createPolicyChargeError("Invalid policy charge type", 400);
  }

  return normalized;
};

const getPolicyChargeCurrency = (appointment, business) =>
  normalizeCurrency(
    appointment?.service?.currency ||
      business?.currency ||
      appointment?.currency ||
      "USD"
  );

const buildPolicySnapshotForCharge = ({ policy, appointment }) => ({
  version: Number(policy.version) || 0,
  source: policy.source || "",
  depositRequired: policy.depositRequired === true,
  depositAmount: normalizeAmount(policy.depositAmount),
  noShowPenaltyEnabled: policy.noShowPenaltyEnabled === true,
  noShowPenaltyAmount: normalizeAmount(policy.noShowPenaltyAmount),
  lateCancelFeeEnabled: policy.lateCancelFeeEnabled === true,
  lateCancelFeeAmount: normalizeAmount(policy.lateCancelFeeAmount),
  policyOutcomeType: appointment?.policyOutcome?.type || "",
  policyOutcomeFeeAmount: normalizeAmount(appointment?.policyOutcome?.feeAmount),
});

const assertRequestedAmountMatches = (requestedAmount, expectedAmount) => {
  if (requestedAmount === undefined || requestedAmount === null || requestedAmount === "") {
    return;
  }

  if (!amountsMatch(requestedAmount, expectedAmount)) {
    throw createPolicyChargeError(
      "Policy charge amount must match the frozen appointment policy",
      400
    );
  }
};

const buildDepositQuote = ({ appointment, policy }) => {
  if (["Canceled", "No-Show", "Missed", "Completed"].includes(appointment.status)) {
    throw createPolicyChargeError(
      "Deposit can only be charged before the appointment is terminal",
      409
    );
  }

  const amount = normalizeAmount(policy.depositAmount);
  if (policy.depositRequired !== true || amount <= 0) {
    throw createPolicyChargeError(
      "No deposit is required by the frozen appointment policy",
      400
    );
  }

  return {
    type: POLICY_CHARGE_TYPES.DEPOSIT,
    amount,
  };
};

const buildOutcomeFeeQuote = ({ appointment, policy, type }) => {
  const expectedOutcome =
    type === POLICY_CHARGE_TYPES.NO_SHOW_FEE ? "no_show" : "late_cancel";
  const outcome = appointment.policyOutcome || {};

  if (outcome.type !== expectedOutcome) {
    throw createPolicyChargeError(
      "Policy charge requires a matching appointment policy outcome",
      409
    );
  }

  if (outcome.waived === true || appointment.penalty?.waived === true) {
    throw createPolicyChargeError("Policy fee was waived", 409);
  }

  const amount = normalizeAmount(
    outcome.feeApplied ? outcome.feeAmount : appointment.penalty?.amount
  );
  if (amount <= 0) {
    throw createPolicyChargeError("No policy fee is available for this appointment", 400);
  }

  const snapshotAmount =
    type === POLICY_CHARGE_TYPES.NO_SHOW_FEE
      ? normalizeAmount(policy.noShowPenaltyAmount)
      : normalizeAmount(policy.lateCancelFeeAmount);
  if (snapshotAmount > 0 && !amountsMatch(amount, snapshotAmount)) {
    throw createPolicyChargeError(
      "Policy charge amount does not match the frozen appointment policy",
      409
    );
  }

  return {
    type,
    amount,
  };
};

const buildPolicyChargeQuote = ({ appointment, business, type }) => {
  const normalizedType = normalizePolicyChargeType(type);
  const policy = getEffectivePolicySnapshot(appointment, business);

  const quote =
    normalizedType === POLICY_CHARGE_TYPES.DEPOSIT
      ? buildDepositQuote({ appointment, policy })
      : buildOutcomeFeeQuote({ appointment, policy, type: normalizedType });

  return {
    ...quote,
    currency: getPolicyChargeCurrency(appointment, business),
    policy,
    policySnapshot: buildPolicySnapshotForCharge({ policy, appointment }),
  };
};

const getStripeCustomerPayload = ({ client, business }) => ({
  email: client.email || undefined,
  phone: client.phone || undefined,
  name: [client.firstName, client.lastName].filter(Boolean).join(" ") || undefined,
  metadata: {
    businessId: String(business._id),
    clientId: String(client._id),
  },
});

const ensureStripeCustomerForClient = async ({ client, business, saveCardOnFile }) => {
  if (client.stripeCustomerId) {
    if (saveCardOnFile && client.cardOnFile?.status !== "usable") {
      client.cardOnFile = {
        ...(client.cardOnFile || {}),
        status: "pending",
        provider: stripePaymentProvider.provider,
        lastSyncedAt: new Date(),
      };
      await client.save();
    }

    return client.stripeCustomerId;
  }

  const customer = await stripe.customers.create(
    getStripeCustomerPayload({ client, business })
  );
  client.stripeCustomerId = customer.id;
  if (saveCardOnFile) {
    client.cardOnFile = {
      status: "pending",
      provider: stripePaymentProvider.provider,
      paymentMethodId: "",
      sourceAppointment: null,
      lastSyncedAt: new Date(),
    };
  }
  await client.save();
  return customer.id;
};

const sameChargeShape = (charge, { appointment, type, amount }) =>
  String(charge.appointment) === String(appointment._id) &&
  charge.type === type &&
  amountsMatch(charge.amount, amount);

const findExistingActivePolicyCharge = ({ business, appointment, type }) =>
  PolicyCharge.findOne({
    business: business._id,
    appointment: appointment._id,
    type,
    status: { $in: ACTIVE_POLICY_CHARGE_STATUSES },
  });

const createPolicyChargeIntent = async ({
  appointment,
  business,
  client,
  actorId,
  type,
  idempotencyKey,
  requestedAmount,
  saveCardOnFile = false,
}) => {
  const normalizedKey = String(idempotencyKey || "").trim();
  if (!normalizedKey) {
    throw createPolicyChargeError("Idempotency-Key is required", 400);
  }

  const quote = buildPolicyChargeQuote({ appointment, business, type });
  assertRequestedAmountMatches(requestedAmount, quote.amount);

  const existingByKey = await PolicyCharge.findOne({
    business: business._id,
    idempotencyKey: normalizedKey,
  });
  if (existingByKey) {
    if (!sameChargeShape(existingByKey, { appointment, type: quote.type, amount: quote.amount })) {
      throw createPolicyChargeError(
        "Idempotency key already used for a different policy charge",
        409
      );
    }

    return {
      policyCharge: existingByKey,
      created: false,
    };
  }

  const activeCharge = await findExistingActivePolicyCharge({
    business,
    appointment,
    type: quote.type,
  });
  if (activeCharge) {
    throw createPolicyChargeError(
      "An active policy charge already exists for this appointment and type",
      409
    );
  }

  const providerCustomerId = await ensureStripeCustomerForClient({
    client,
    business,
    saveCardOnFile,
  });

  const policyCharge = await PolicyCharge.create({
    type: quote.type,
    status: POLICY_CHARGE_STATUS.PROCESSING,
    appointment: appointment._id,
    business: business._id,
    client: client._id,
    amount: quote.amount,
    currency: quote.currency,
    provider: stripePaymentProvider.provider,
    providerCustomerId,
    idempotencyKey: normalizedKey,
    policySnapshot: quote.policySnapshot,
    saveCardOnFile: saveCardOnFile === true,
    createdBy: actorId,
  });

  try {
    const intent = await stripe.paymentIntents.create(
      {
        ...stripePaymentProvider.buildPolicyChargeIntentPayload({
          amount: quote.amount,
          currency: quote.currency,
          customerId: providerCustomerId,
          saveCardOnFile,
          metadata: stripePaymentProvider.buildPolicyChargeMetadata({
            charge: policyCharge,
            business,
            appointment,
            client,
          }),
        }),
      },
      {
        idempotencyKey: stripePaymentProvider.buildIdempotencyKey(
          "policy-charge",
          business._id,
          normalizedKey
        ),
      }
    );

    policyCharge.status = intent.status || POLICY_CHARGE_STATUS.REQUIRES_PAYMENT_METHOD;
    policyCharge.providerReference = stripePaymentProvider.references.raw(intent.id);
    policyCharge.clientSecret = intent.client_secret || "";
    await policyCharge.save();

    await recordDomainEvent({
      type: "policy_charge_intent_created",
      actorId,
      shopId: business._id,
      correlationId: policyCharge._id,
      payload: {
        policyChargeId: policyCharge._id,
        appointmentId: appointment._id,
        clientId: client._id,
        type: policyCharge.type,
        amount: policyCharge.amount,
        currency: policyCharge.currency,
      },
    });

    return {
      policyCharge,
      created: true,
    };
  } catch (error) {
    policyCharge.status = POLICY_CHARGE_STATUS.FAILED;
    policyCharge.failedAt = new Date();
    policyCharge.failureReason = error.message || "stripe_intent_failed";
    await policyCharge.save();
    throw error;
  }
};

const findPolicyChargeForPaymentIntent = async (paymentIntent, mongoSession = null) => {
  const policyChargeId = paymentIntent.metadata?.policyChargeId;
  const providerReference = paymentIntent.id || "";
  const query = policyChargeId
    ? PolicyCharge.findById(policyChargeId)
    : PolicyCharge.findOne({
        provider: PAYMENT_PROVIDER.STRIPE,
        providerReference,
      });

  return mongoSession ? query.session(mongoSession) : query;
};

const buildPolicyPaymentSnapshot = ({ amount, appointment, policyCharge }) => ({
  subtotal: amount,
  discountTotal: 0,
  total: amount,
  sourcePrice: amount,
  service: {
    id:
      appointment?.service && typeof appointment.service === "object"
        ? appointment.service._id || appointment.service.id || null
        : appointment?.service || null,
    name:
      appointment?.service && typeof appointment.service === "object"
        ? appointment.service.name || ""
        : "",
  },
  client: {
    id: policyCharge.client,
    firstName: "",
    lastName: "",
  },
  discounts: {
    promotionAmount: 0,
    flashSaleAmount: 0,
  },
  policyCharge: {
    id: policyCharge._id,
    type: policyCharge.type,
    policySource: policyCharge.policySnapshot?.source || "",
    policyVersion: policyCharge.policySnapshot?.version || 0,
  },
});

const createOrUpdatePolicyPayment = async ({
  paymentIntent,
  policyCharge,
  appointment,
  amount,
  eventId,
  mongoSession,
}) => {
  const providerReference = stripePaymentProvider.references.paymentIntent(
    paymentIntent.id
  );
  const existingPayment = await Payment.findOne(
    buildPolicyPaymentFilter({
      provider: PAYMENT_PROVIDER.STRIPE,
      providerReference,
    })
  ).session(mongoSession);

  if (existingPayment) {
    return {
      payment: existingPayment,
      action: "existing_payment",
    };
  }

  const paymentPayload = {
    paymentScope: PAYMENT_SCOPE.COMMERCE_POLICY,
    appointment: policyCharge.appointment,
    business: policyCharge.business,
    client: policyCharge.client,
    staff: appointment?.staff || null,
    status: "captured",
    method: stripePaymentProvider.method,
    provider: PAYMENT_PROVIDER.STRIPE,
    providerReference,
    providerEventId: eventId || "",
    providerCustomerId: paymentIntent.customer || policyCharge.providerCustomerId || "",
    currency: policyCharge.currency,
    amount,
    tip: 0,
    reference: policyCharge.type,
    capturedAt: new Date(),
    capturedBy: policyCharge.createdBy,
    snapshot: buildPolicyPaymentSnapshot({
      amount,
      appointment,
      policyCharge,
    }),
  };

  const [payment] = await Payment.create([paymentPayload], {
    session: mongoSession,
  });
  return {
    payment,
    action: "created_payment",
  };
};

const markPolicyPenaltyPaid = async ({ policyCharge, mongoSession }) => {
  if (
    ![
      POLICY_CHARGE_TYPES.NO_SHOW_FEE,
      POLICY_CHARGE_TYPES.LATE_CANCEL_FEE,
    ].includes(policyCharge.type)
  ) {
    return;
  }

  await Appointment.updateOne(
    { _id: policyCharge.appointment },
    {
      $set: {
        "penalty.paid": true,
        "penalty.paidDate": new Date(),
      },
    },
    { session: mongoSession }
  );
};

const markCardOnFileUsable = async ({ policyCharge, paymentIntent, mongoSession }) => {
  const shouldSave =
    policyCharge.saveCardOnFile === true ||
    paymentIntent.metadata?.saveCardOnFile === "true";
  if (!shouldSave || !paymentIntent.payment_method) {
    return;
  }

  await Client.updateOne(
    { _id: policyCharge.client },
    {
      $set: {
        stripeCustomerId:
          paymentIntent.customer || policyCharge.providerCustomerId || "",
        cardOnFile: {
          status: "usable",
          provider: stripePaymentProvider.provider,
          paymentMethodId: paymentIntent.payment_method,
          sourceAppointment: policyCharge.appointment,
          lastSyncedAt: new Date(),
        },
      },
    },
    { session: mongoSession }
  );
};

const createWebhookProcessingResult = (message, meta = {}) => ({
  message,
  meta,
});

const processPolicyChargePaymentSucceeded = async (paymentIntent, eventId = "") => {
  const mongoSession = await mongoose.startSession();
  let resultMeta = null;

  try {
    await mongoSession.withTransaction(async () => {
      const policyCharge = await findPolicyChargeForPaymentIntent(
        paymentIntent,
        mongoSession
      );
      if (!policyCharge) {
        resultMeta = {
          eventType: "payment_intent.succeeded",
          reason: "policy_charge_not_found",
          paymentIntentId: paymentIntent.id || "",
        };
        return;
      }

      const amount = fromMinorUnit(
        paymentIntent.amount_received || paymentIntent.amount || 0
      );
      if (!amountsMatch(amount, policyCharge.amount)) {
        policyCharge.status = POLICY_CHARGE_STATUS.FAILED;
        policyCharge.failedAt = new Date();
        policyCharge.failureReason = "payment_intent_amount_mismatch";
        await policyCharge.save({ session: mongoSession });
        resultMeta = {
          eventType: "payment_intent.succeeded",
          policyChargeId: String(policyCharge._id),
          reason: "payment_intent_amount_mismatch",
        };
        return;
      }

      const appointment = await Appointment.findById(policyCharge.appointment)
        .populate("service")
        .session(mongoSession);
      const { payment, action } = await createOrUpdatePolicyPayment({
        paymentIntent,
        policyCharge,
        appointment,
        amount,
        eventId,
        mongoSession,
      });

      policyCharge.status = POLICY_CHARGE_STATUS.SUCCEEDED;
      policyCharge.providerEventId = eventId || policyCharge.providerEventId;
      policyCharge.providerCustomerId =
        paymentIntent.customer || policyCharge.providerCustomerId;
      policyCharge.payment = payment._id;
      policyCharge.paidAt = policyCharge.paidAt || new Date();
      policyCharge.failedAt = null;
      policyCharge.failureReason = "";
      await policyCharge.save({ session: mongoSession });

      await markPolicyPenaltyPaid({ policyCharge, mongoSession });
      await markCardOnFileUsable({
        policyCharge,
        paymentIntent,
        mongoSession,
      });

      resultMeta = {
        eventType: "payment_intent.succeeded",
        policyChargeId: String(policyCharge._id),
        businessId: String(policyCharge.business),
        actorId: String(policyCharge.createdBy),
        paymentId: String(payment._id),
        action,
        paymentScope: PAYMENT_SCOPE.COMMERCE_POLICY,
      };
    });
  } finally {
    await mongoSession.endSession();
  }

  if (!resultMeta || resultMeta.reason === "policy_charge_not_found") {
    return createWebhookProcessingResult("Policy charge not found, skipping", resultMeta);
  }

  if (resultMeta.reason === "payment_intent_amount_mismatch") {
    return createWebhookProcessingResult("Policy charge payment amount mismatch", resultMeta);
  }

  if (resultMeta.action === "created_payment") {
    await recordDomainEvent({
      type: "policy_charge_captured",
      actorId: resultMeta.actorId,
      actorType: "system",
      shopId: resultMeta.businessId,
      source: "stripe_webhook",
      correlationId: resultMeta.policyChargeId,
      payload: resultMeta,
    });
  }

  return createWebhookProcessingResult("Policy charge payment recorded", resultMeta);
};

const processPolicyChargePaymentFailed = async (paymentIntent, eventId = "") => {
  const policyCharge = await findPolicyChargeForPaymentIntent(paymentIntent);
  if (!policyCharge) {
    return createWebhookProcessingResult("Policy charge not found, skipping", {
      eventType: "payment_intent.payment_failed",
      reason: "policy_charge_not_found",
      paymentIntentId: paymentIntent.id || "",
    });
  }

  const failureReason =
    paymentIntent.last_payment_error?.message ||
    paymentIntent.cancellation_reason ||
    paymentIntent.status ||
    "payment_failed";

  policyCharge.status = POLICY_CHARGE_STATUS.FAILED;
  policyCharge.failedAt = new Date();
  policyCharge.failureReason = failureReason;
  policyCharge.providerEventId = eventId || policyCharge.providerEventId;
  await policyCharge.save();

  await recordDomainEvent({
    type: "policy_charge_failed",
    actorType: "system",
    actorId: policyCharge.createdBy,
    shopId: policyCharge.business,
    source: "stripe_webhook",
    correlationId: policyCharge._id,
    payload: {
      eventType: "payment_intent.payment_failed",
      policyChargeId: policyCharge._id,
      paymentIntentId: paymentIntent.id || "",
      failureReason,
    },
  });

  return createWebhookProcessingResult("Policy charge payment failure recorded", {
    eventType: "payment_intent.payment_failed",
    policyChargeId: String(policyCharge._id),
    reason: failureReason,
  });
};

module.exports = {
  POLICY_CHARGE_STATUS,
  POLICY_CHARGE_TYPES,
  buildPolicyChargeQuote,
  createPolicyChargeError,
  createPolicyChargeIntent,
  processPolicyChargePaymentFailed,
  processPolicyChargePaymentSucceeded,
};
