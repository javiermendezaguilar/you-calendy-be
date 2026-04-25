const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const refundSchema = new Schema(
  {
    payment: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
    },
    checkout: {
      type: Schema.Types.ObjectId,
      ref: "Checkout",
      required: true,
    },
    appointment: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
    },
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    client: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    staff: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      default: null,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      enum: [
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
      ],
      default: "USD",
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    idempotencyKey: {
      type: String,
      trim: true,
    },
    refundedAt: {
      type: Date,
      default: Date.now,
    },
    refundedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

refundSchema.index({ payment: 1, refundedAt: -1 });
refundSchema.index({ business: 1, refundedAt: -1 });
refundSchema.index(
  { payment: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $exists: true } },
  }
);

module.exports = mongoose.model("Refund", refundSchema);
