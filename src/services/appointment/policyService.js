const POLICY_SNAPSHOT_VERSION = 3;

const toNonNegativeNumber = (value) => {
  const numberValue = Number(value) || 0;
  return numberValue > 0 ? numberValue : 0;
};

const normalizeBlockScope = (blockOnNoShow) => {
  if (!blockOnNoShow) {
    return "none";
  }

  return "business";
};

const buildPolicySnapshotFromBusiness = (business) => {
  const policySettings = business?.policySettings || {};
  const lateCancelFeeEnabled = policySettings.lateCancelFeeEnabled === true;
  const depositRequired = policySettings.depositRequired === true;
  const blockOnNoShow = policySettings.blockOnNoShow === true;

  return {
    version: POLICY_SNAPSHOT_VERSION,
    capturedAt: new Date(),
    bookingBufferMinutes: toNonNegativeNumber(business?.bookingBuffer),
    cancellationWindowMinutes: toNonNegativeNumber(
      policySettings.cancellationWindowMinutes
    ),
    noShowGracePeriodMinutes: toNonNegativeNumber(
      policySettings.noShowGracePeriodMinutes
    ),
    noShowPenaltyEnabled: business?.penaltySettings?.noShowPenalty === true,
    noShowPenaltyAmount: toNonNegativeNumber(
      business?.penaltySettings?.noShowPenaltyAmount
    ),
    lateCancelFeeEnabled,
    lateCancelFeeAmount: lateCancelFeeEnabled
      ? toNonNegativeNumber(policySettings.lateCancelFeeAmount)
      : 0,
    depositRequired,
    depositAmount: depositRequired
      ? toNonNegativeNumber(policySettings.depositAmount)
      : 0,
    blockOnNoShow,
    blockScope: normalizeBlockScope(blockOnNoShow),
  };
};

const normalizePolicySnapshot = (snapshot, source) => {
  const blockOnNoShow = snapshot.blockOnNoShow === true;

  return {
    version: snapshot.version || 1,
    capturedAt: snapshot.capturedAt || null,
    bookingBufferMinutes: toNonNegativeNumber(snapshot.bookingBufferMinutes),
    cancellationWindowMinutes: toNonNegativeNumber(
      snapshot.cancellationWindowMinutes
    ),
    noShowGracePeriodMinutes: toNonNegativeNumber(
      snapshot.noShowGracePeriodMinutes
    ),
    noShowPenaltyEnabled: snapshot.noShowPenaltyEnabled === true,
    noShowPenaltyAmount: toNonNegativeNumber(snapshot.noShowPenaltyAmount),
    lateCancelFeeEnabled: snapshot.lateCancelFeeEnabled === true,
    lateCancelFeeAmount: toNonNegativeNumber(snapshot.lateCancelFeeAmount),
    depositRequired: snapshot.depositRequired === true,
    depositAmount: toNonNegativeNumber(snapshot.depositAmount),
    blockOnNoShow,
    blockScope: normalizeBlockScope(blockOnNoShow),
    source,
  };
};

const getEffectivePolicySnapshot = (appointment, business) => {
  const snapshot = appointment?.policySnapshot || {};

  const hasSnapshotMetadata =
    Boolean(snapshot.capturedAt) ||
    Number(snapshot.version) >= 2 ||
    Number(snapshot.bookingBufferMinutes) > 0;

  const hasExplicitPenaltyRule =
    snapshot.noShowPenaltyEnabled === true ||
    Number(snapshot.noShowPenaltyAmount) > 0;

  const hasFrozenNoShowPenalty =
    hasSnapshotMetadata || hasExplicitPenaltyRule;

  if (hasFrozenNoShowPenalty) {
    return normalizePolicySnapshot(snapshot, "snapshot");
  }

  const fallback = buildPolicySnapshotFromBusiness(business);
  return normalizePolicySnapshot(fallback, "business-fallback");
};

const buildNoShowPenaltyFromPolicy = (policy) => {
  if (!policy?.noShowPenaltyEnabled) {
    return null;
  }

  const amount = Number(policy.noShowPenaltyAmount) || 0;
  if (amount <= 0) {
    return null;
  }

  return {
    applied: true,
    amount,
    paid: false,
  };
};

module.exports = {
  POLICY_SNAPSHOT_VERSION,
  buildPolicySnapshotFromBusiness,
  getEffectivePolicySnapshot,
  buildNoShowPenaltyFromPolicy,
};
