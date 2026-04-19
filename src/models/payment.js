const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const paymentSchema = new Schema(
  {
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
    cashSession: {
      type: Schema.Types.ObjectId,
      ref: "CashSession",
      default: null,
    },
    status: {
      type: String,
      enum: ["captured", "voided", "refunded_partial", "refunded_full"],
      default: "captured",
    },
    method: {
      type: String,
      enum: ["cash", "card_manual", "other"],
      required: true,
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
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    tip: {
      type: Number,
      default: 0,
      min: 0,
    },
    reference: {
      type: String,
      trim: true,
      default: "",
    },
    capturedAt: {
      type: Date,
      default: Date.now,
    },
    capturedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    voidedAt: {
      type: Date,
      default: null,
    },
    voidedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    voidReason: {
      type: String,
      trim: true,
      default: "",
    },
    snapshot: {
      subtotal: {
        type: Number,
        default: 0,
      },
      discountTotal: {
        type: Number,
        default: 0,
      },
      total: {
        type: Number,
        default: 0,
      },
      sourcePrice: {
        type: Number,
        default: 0,
      },
      service: {
        id: {
          type: Schema.Types.ObjectId,
          ref: "Service",
          default: null,
        },
        name: {
          type: String,
          default: "",
        },
      },
      client: {
        id: {
          type: Schema.Types.ObjectId,
          ref: "Client",
          default: null,
        },
        firstName: {
          type: String,
          default: "",
        },
        lastName: {
          type: String,
          default: "",
        },
      },
      discounts: {
        promotionAmount: {
          type: Number,
          default: 0,
        },
        flashSaleAmount: {
          type: Number,
          default: 0,
        },
      },
    },
    refundedTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

paymentSchema.index(
  { checkout: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "captured" },
  }
);

paymentSchema.index({ business: 1, capturedAt: -1 });
paymentSchema.index({ appointment: 1, capturedAt: -1 });
paymentSchema.index({ cashSession: 1, capturedAt: -1 });

module.exports = mongoose.model("Payment", paymentSchema);
