const buildPolicySnapshotFromBusiness = (business) => ({
  version: 2,
  capturedAt: new Date(),
  bookingBufferMinutes: Number(business?.bookingBuffer) || 0,
  noShowPenaltyEnabled: business?.penaltySettings?.noShowPenalty === true,
  noShowPenaltyAmount:
    Number(business?.penaltySettings?.noShowPenaltyAmount) || 0,
});

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
    return {
      version: snapshot.version || 1,
      capturedAt: snapshot.capturedAt || null,
      bookingBufferMinutes: Number(snapshot.bookingBufferMinutes) || 0,
      noShowPenaltyEnabled: snapshot.noShowPenaltyEnabled === true,
      noShowPenaltyAmount: Number(snapshot.noShowPenaltyAmount) || 0,
      source: "snapshot",
    };
  }

  const fallback = buildPolicySnapshotFromBusiness(business);
  return {
    ...fallback,
    source: "business-fallback",
  };
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
  buildPolicySnapshotFromBusiness,
  getEffectivePolicySnapshot,
  buildNoShowPenaltyFromPolicy,
};
