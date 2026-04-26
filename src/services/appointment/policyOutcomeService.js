const {
  buildNoShowPenaltyFromPolicy,
  getEffectivePolicySnapshot,
} = require("./policyService");

const OUTCOME_TYPES = {
  NONE: "none",
  NO_SHOW: "no_show",
  LATE_CANCEL: "late_cancel",
};

const createPolicyError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const toBoolean = (value) => value === true || value === "true";

const normalizeOptionalText = (value) => {
  const normalized = String(value || "").trim();
  return normalized || "";
};

const getAppointmentScheduledStartAt = (appointment) => {
  const datePart = new Date(appointment.date).toISOString().slice(0, 10);
  const timePart = String(appointment.startTime || "00:00").trim();
  const normalizedTime = /^\d{2}:\d{2}$/.test(timePart)
    ? timePart
    : "00:00";

  return new Date(`${datePart}T${normalizedTime}:00.000Z`);
};

const getNoShowEligibleAt = (appointment, policy) => {
  const scheduledStartAt = getAppointmentScheduledStartAt(appointment);
  const graceMs = Number(policy.noShowGracePeriodMinutes || 0) * 60 * 1000;
  return new Date(scheduledStartAt.getTime() + graceMs);
};

const isWithinLateCancelWindow = (appointment, policy, now = new Date()) => {
  const windowMinutes = Number(policy.cancellationWindowMinutes || 0);
  if (windowMinutes <= 0) {
    return false;
  }

  const scheduledStartAt = getAppointmentScheduledStartAt(appointment);
  const lateCancelStartsAt = new Date(
    scheduledStartAt.getTime() - windowMinutes * 60 * 1000
  );

  return now >= lateCancelStartsAt;
};

const resolveWaiver = ({ payload, isBusinessOwner }) => {
  const waived = toBoolean(payload.waiveFee);
  const waiverReason = normalizeOptionalText(payload.waiverReason);

  if (!waived) {
    return { waived: false, waiverReason: "" };
  }

  if (!isBusinessOwner) {
    throw createPolicyError("Only the business owner can waive policy fees", 403);
  }

  if (!waiverReason) {
    throw createPolicyError("Waiver reason is required", 400);
  }

  return { waived: true, waiverReason };
};

const buildOutcome = ({
  type,
  appointment,
  actorId,
  policy,
  reason,
  note,
  waived,
  waiverReason,
  feeApplied,
  feeAmount,
  blockApplied = false,
}) => ({
  type,
  reason,
  note,
  decidedAt: new Date(),
  decidedBy: actorId,
  waived,
  waiverReason,
  feeApplied,
  feeAmount,
  blockApplied,
  policySource: policy.source,
  policyVersion: policy.version,
  scheduledStartAt: getAppointmentScheduledStartAt(appointment),
});

const buildPenaltyFromOutcome = (outcome) => ({
  applied: outcome.feeApplied,
  amount: outcome.feeAmount,
  paid: false,
  type: outcome.type,
  source: "policy_snapshot",
  waived: outcome.waived,
  waivedReason: outcome.waiverReason,
  assessedAt: outcome.decidedAt,
  assessedBy: outcome.decidedBy,
  notes: outcome.note || outcome.reason,
});

const resolveNoShowOutcome = ({
  appointment,
  business,
  actorId,
  payload = {},
  isBusinessOwner,
  now = new Date(),
}) => {
  if (["checked_in", "in_service", "completed"].includes(appointment.visitStatus)) {
    throw createPolicyError(
      "Cannot mark a checked-in, in-service or completed appointment as No-Show",
      409
    );
  }

  const policy = getEffectivePolicySnapshot(appointment, business);
  const noShowEligibleAt = getNoShowEligibleAt(appointment, policy);
  if (now < noShowEligibleAt) {
    throw createPolicyError(
      "Cannot mark appointment as No-Show before the grace period has passed",
      409
    );
  }

  const { waived, waiverReason } = resolveWaiver({ payload, isBusinessOwner });
  const noShowPenalty = waived ? null : buildNoShowPenaltyFromPolicy(policy);
  const feeApplied = Boolean(noShowPenalty);
  const feeAmount = noShowPenalty?.amount || 0;
  const blockApplied =
    !waived && policy.blockOnNoShow === true && toBoolean(payload.blockClient);

  const outcome = buildOutcome({
    type: OUTCOME_TYPES.NO_SHOW,
    appointment,
    actorId,
    policy,
    reason: normalizeOptionalText(payload.reason) || "no_show",
    note: normalizeOptionalText(payload.incidentNote),
    waived,
    waiverReason,
    feeApplied,
    feeAmount,
    blockApplied,
  });

  return {
    policy,
    outcome,
    penalty: buildPenaltyFromOutcome(outcome),
    blockApplied,
  };
};

const resolveCancellationOutcome = ({
  appointment,
  business,
  actorId,
  payload = {},
  isBusinessOwner,
  now = new Date(),
}) => {
  const policy = getEffectivePolicySnapshot(appointment, business);
  const { waived, waiverReason } = resolveWaiver({ payload, isBusinessOwner });
  const isLateCancel = isWithinLateCancelWindow(appointment, policy, now);

  if (!isLateCancel) {
    return {
      policy,
      outcome: null,
      penalty: null,
    };
  }

  const feeAmount =
    !waived && policy.lateCancelFeeEnabled
      ? Number(policy.lateCancelFeeAmount || 0)
      : 0;
  const feeApplied = feeAmount > 0;

  const outcome = buildOutcome({
    type: OUTCOME_TYPES.LATE_CANCEL,
    appointment,
    actorId,
    policy,
    reason: normalizeOptionalText(payload.reason) || "late_cancel",
    note: normalizeOptionalText(payload.incidentNote || payload.comment),
    waived,
    waiverReason,
    feeApplied,
    feeAmount,
  });

  return {
    policy,
    outcome,
    penalty: buildPenaltyFromOutcome(outcome),
  };
};

const getExpectedPolicyFeeForAppointment = (appointment, business) => {
  const policy = getEffectivePolicySnapshot(appointment, business);
  const outcomeType = appointment?.policyOutcome?.type;

  if (appointment?.policyOutcome?.waived) {
    return {
      type: outcomeType || OUTCOME_TYPES.NONE,
      amount: 0,
      waived: true,
      policy,
    };
  }

  if (
    outcomeType === OUTCOME_TYPES.LATE_CANCEL ||
    appointment?.status === "Canceled"
  ) {
    return {
      type: OUTCOME_TYPES.LATE_CANCEL,
      amount: policy.lateCancelFeeEnabled
        ? Number(policy.lateCancelFeeAmount || 0)
        : 0,
      waived: false,
      policy,
    };
  }

  if (appointment?.status === "No-Show" || appointment?.status === "Missed") {
    const noShowPenalty = buildNoShowPenaltyFromPolicy(policy);
    return {
      type: OUTCOME_TYPES.NO_SHOW,
      amount: noShowPenalty?.amount || 0,
      waived: false,
      policy,
    };
  }

  return {
    type: OUTCOME_TYPES.NONE,
    amount: 0,
    waived: false,
    policy,
  };
};

module.exports = {
  OUTCOME_TYPES,
  buildPenaltyFromOutcome,
  createPolicyError,
  getAppointmentScheduledStartAt,
  getExpectedPolicyFeeForAppointment,
  isWithinLateCancelWindow,
  resolveCancellationOutcome,
  resolveNoShowOutcome,
  toBoolean,
};
