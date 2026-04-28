const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const currencyEnum = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "CHF",
  "CNY",
  "INR",
  "BRL",
];

const policyChargeSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["deposit", "no_show_fee", "late_cancel_fee"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        "processing",
        "requires_payment_method",
        "requires_confirmation",
        "requires_action",
        "succeeded",
        "failed",
        "cancelled",
      ],
      default: "processing",
      index: true,
    },
    appointment: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      index: true,
    },
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    client: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      enum: currencyEnum,
      default: "USD",
    },
    provider: {
      type: String,
      enum: ["stripe"],
      default: "stripe",
    },
    providerReference: {
      type: String,
      trim: true,
      default: "",
    },
    providerEventId: {
      type: String,
      trim: true,
      default: "",
    },
    providerCustomerId: {
      type: String,
      trim: true,
      default: "",
    },
    clientSecret: {
      type: String,
      trim: true,
      default: "",
    },
    idempotencyKey: {
      type: String,
      trim: true,
      required: true,
    },
    source: {
      type: String,
      enum: ["policy_snapshot"],
      default: "policy_snapshot",
    },
    policySnapshot: {
      version: {
        type: Number,
        default: 0,
      },
      source: {
        type: String,
        default: "",
      },
      depositRequired: {
        type: Boolean,
        default: false,
      },
      depositAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
      noShowPenaltyEnabled: {
        type: Boolean,
        default: false,
      },
      noShowPenaltyAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
      lateCancelFeeEnabled: {
        type: Boolean,
        default: false,
      },
      lateCancelFeeAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
      policyOutcomeType: {
        type: String,
        default: "",
      },
      policyOutcomeFeeAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    saveCardOnFile: {
      type: Boolean,
      default: false,
    },
    payment: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

policyChargeSchema.index(
  { business: 1, idempotencyKey: 1 },
  { unique: true }
);
policyChargeSchema.index({ business: 1, appointment: 1, type: 1, status: 1 });
policyChargeSchema.index(
  { provider: 1, providerReference: 1 },
  {
    unique: true,
    partialFilterExpression: {
      provider: "stripe",
      providerReference: { $exists: true, $gt: "" },
    },
  }
);

module.exports = mongoose.model("PolicyCharge", policyChargeSchema);
