const nonNegativeNumberField = () => ({
  type: Number,
  default: 0,
  min: 0,
});

const booleanField = () => ({
  type: Boolean,
  default: false,
});

const blockScopeField = () => ({
  type: String,
  enum: ["none", "business"],
  default: "none",
});

const buildPolicyRuleFields = () => ({
  cancellationWindowMinutes: nonNegativeNumberField(),
  noShowGracePeriodMinutes: nonNegativeNumberField(),
  lateCancelFeeEnabled: booleanField(),
  lateCancelFeeAmount: nonNegativeNumberField(),
  depositRequired: booleanField(),
  depositAmount: nonNegativeNumberField(),
  blockOnNoShow: booleanField(),
  blockScope: blockScopeField(),
});

const buildPolicySnapshotFields = () => ({
  version: {
    type: Number,
    default: 1,
  },
  capturedAt: {
    type: Date,
    default: null,
  },
  bookingBufferMinutes: nonNegativeNumberField(),
  noShowPenaltyEnabled: booleanField(),
  noShowPenaltyAmount: nonNegativeNumberField(),
  ...buildPolicyRuleFields(),
});

module.exports = {
  buildPolicyRuleFields,
  buildPolicySnapshotFields,
};
