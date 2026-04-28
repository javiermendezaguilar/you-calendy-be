const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { buildPlanLimitFields } = require("./planLimitFields");

const planLimitsSchema = new Schema(
  buildPlanLimitFields(),
  { _id: false }
);

const planSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    features: [
      {
        type: String,
        trim: true,
      },
    ],
    featureKeys: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    limits: {
      type: planLimitsSchema,
      default: () => ({}),
    },
    stripePriceId: {
      type: String,
      required: true,
      unique: true,
    },
    stripeProductId: {
      type: String,
      required: true,
    },
    currency: {
      type: String,
      default: "usd",
      enum: ["usd", "eur", "gbp", "cad", "aud"],
    },
    billingInterval: {
      type: String,
      default: "month",
      enum: ["month", "year", "week", "day"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // sortOrder: {
    //   type: Number,
    //   default: 0,
    // },
  },
  { timestamps: true }
);

// Index for queries
planSchema.index({
  isActive: 1,
  // sortOrder: 1
});
planSchema.index({ title: "text", description: "text" });
planSchema.index({ stripePriceId: 1 }, { unique: true });

module.exports = mongoose.model("Plan", planSchema);
