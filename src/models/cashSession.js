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

const cashSessionSchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
    },
    currency: {
      type: String,
      enum: currencyEnum,
      default: "EUR",
    },
    openingFloat: {
      type: Number,
      required: true,
      min: 0,
    },
    openingSource: {
      type: String,
      enum: ["manual", "handoff"],
      default: "manual",
    },
    openingReason: {
      type: String,
      enum: ["manual_start", "manual_adjustment", "handoff"],
      default: "manual_start",
    },
    openingNote: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    handoffFrom: {
      type: Schema.Types.ObjectId,
      ref: "CashSession",
      default: null,
    },
    closingExpected: {
      type: Number,
      default: 0,
      min: 0,
    },
    closingDeclared: {
      type: Number,
      default: 0,
      min: 0,
    },
    summary: {
      cashSalesTotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      tipsTotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      transactionCount: {
        type: Number,
        default: 0,
        min: 0,
      },
      expectedDrawerTotal: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    variance: {
      type: Number,
      default: 0,
    },
    varianceStatus: {
      type: String,
      enum: ["exact", "over", "short"],
      default: "exact",
    },
    closingNote: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    payments: [
      {
        type: Schema.Types.ObjectId,
        ref: "Payment",
      },
    ],
    openedAt: {
      type: Date,
      default: Date.now,
    },
    openedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    closedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

cashSessionSchema.index(
  { business: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "open" },
  }
);

cashSessionSchema.index({ business: 1, openedAt: -1 });

module.exports = mongoose.model("CashSession", cashSessionSchema);
