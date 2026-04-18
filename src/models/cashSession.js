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
