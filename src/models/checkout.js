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

const checkoutSchema = new Schema(
  {
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
    status: {
      type: String,
      enum: ["open", "closed", "paid"],
      default: "open",
    },
    currency: {
      type: String,
      enum: currencyEnum,
      default: "USD",
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    discountTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    tip: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    refundSummary: {
      refundedTotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      status: {
        type: String,
        enum: ["none", "partial", "full"],
        default: "none",
      },
    },
    sourcePrice: {
      type: Number,
      required: true,
      min: 0,
    },
    snapshot: {
      appointmentStatus: {
        type: String,
        default: "",
      },
      bookingStatus: {
        type: String,
        default: "",
      },
      visitStatus: {
        type: String,
        default: "",
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
        phone: {
          type: String,
          default: "",
        },
      },
      staff: {
        id: {
          type: Schema.Types.ObjectId,
          ref: "Staff",
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
        promotion: {
          applied: {
            type: Boolean,
            default: false,
          },
          id: {
            type: Schema.Types.ObjectId,
            ref: "Promotion",
            default: null,
          },
          amount: {
            type: Number,
            default: 0,
            min: 0,
          },
        },
        flashSale: {
          applied: {
            type: Boolean,
            default: false,
          },
          id: {
            type: Schema.Types.ObjectId,
            ref: "FlashSale",
            default: null,
          },
          amount: {
            type: Number,
            default: 0,
            min: 0,
          },
        },
      },
    },
    openedAt: {
      type: Date,
      default: Date.now,
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
    rebooking: {
      status: {
        type: String,
        enum: ["none", "follow_up_needed", "declined", "booked"],
        default: "none",
      },
      appointment: {
        type: Schema.Types.ObjectId,
        ref: "Appointment",
        default: null,
      },
      service: {
        type: Schema.Types.ObjectId,
        ref: "Service",
        default: null,
      },
      staff: {
        type: Schema.Types.ObjectId,
        ref: "Staff",
        default: null,
      },
      createdAt: {
        type: Date,
        default: null,
      },
      createdBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      source: {
        type: String,
        enum: ["checkout", "post_checkout", "manual_follow_up"],
        default: "checkout",
      },
      note: {
        type: String,
        default: "",
      },
      offeredAt: {
        type: Date,
        default: null,
      },
      outcomeAt: {
        type: Date,
        default: null,
      },
      outcomeBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
  },
  { timestamps: true }
);

checkoutSchema.index(
  { appointment: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "open" },
  }
);

checkoutSchema.index({ business: 1, openedAt: -1 });
checkoutSchema.index({ client: 1, openedAt: -1 });

module.exports = mongoose.model("Checkout", checkoutSchema);
