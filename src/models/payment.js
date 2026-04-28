const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const {
  PAYMENT_PROVIDER,
  PAYMENT_SCOPE,
} = require("../services/payment/paymentScope");
const {
  createServiceLineSnapshotSchema,
} = require("./serviceLineSnapshotSchema");
const {
  createCheckoutFinancialSnapshotFields,
} = require("./checkoutTotalizationSchemas");

const paymentSchema = new Schema(
  {
    paymentScope: {
      type: String,
      enum: Object.values(PAYMENT_SCOPE),
      default: PAYMENT_SCOPE.COMMERCE_CHECKOUT,
      index: true,
    },
    checkout: {
      type: Schema.Types.ObjectId,
      ref: "Checkout",
      required() {
        return this.paymentScope === PAYMENT_SCOPE.COMMERCE_CHECKOUT;
      },
    },
    appointment: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required() {
        return [
          PAYMENT_SCOPE.COMMERCE_CHECKOUT,
          PAYMENT_SCOPE.COMMERCE_POLICY,
        ].includes(this.paymentScope);
      },
    },
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    client: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      required() {
        return [
          PAYMENT_SCOPE.COMMERCE_CHECKOUT,
          PAYMENT_SCOPE.COMMERCE_POLICY,
        ].includes(this.paymentScope);
      },
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
      enum: ["captured", "failed", "voided", "refunded_partial", "refunded_full"],
      default: "captured",
    },
    method: {
      type: String,
      enum: ["cash", "card_manual", "other", "stripe"],
      required: true,
    },
    provider: {
      type: String,
      enum: Object.values(PAYMENT_PROVIDER),
      default: PAYMENT_PROVIDER.INTERNAL,
    },
    providerReference: {
      type: String,
      trim: true,
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
    providerSubscriptionId: {
      type: String,
      trim: true,
      default: "",
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
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 128,
    },
    capturedAt: {
      type: Date,
      default: Date.now,
    },
    capturedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required() {
        return [
          PAYMENT_SCOPE.COMMERCE_CHECKOUT,
          PAYMENT_SCOPE.COMMERCE_POLICY,
        ].includes(this.paymentScope);
      },
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
      serviceLines: [createServiceLineSnapshotSchema(Schema)],
      ...createCheckoutFinancialSnapshotFields(Schema),
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
      policyCharge: {
        id: {
          type: Schema.Types.ObjectId,
          ref: "PolicyCharge",
          default: null,
        },
        type: {
          type: String,
          default: "",
        },
        policySource: {
          type: String,
          default: "",
        },
        policyVersion: {
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
  { paymentScope: 1, checkout: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentScope: PAYMENT_SCOPE.COMMERCE_CHECKOUT,
      status: "captured",
      checkout: { $exists: true },
    },
  }
);

paymentSchema.index(
  { business: 1, paymentScope: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentScope: PAYMENT_SCOPE.COMMERCE_CHECKOUT,
      idempotencyKey: { $exists: true },
    },
  }
);

paymentSchema.index(
  { paymentScope: 1, provider: 1, providerReference: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentScope: PAYMENT_SCOPE.PLATFORM_BILLING,
      provider: PAYMENT_PROVIDER.STRIPE,
      providerReference: { $exists: true },
    },
  }
);

paymentSchema.index(
  { paymentScope: 1, provider: 1, providerReference: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentScope: PAYMENT_SCOPE.COMMERCE_POLICY,
      provider: PAYMENT_PROVIDER.STRIPE,
      providerReference: { $exists: true },
    },
  }
);

paymentSchema.index({ business: 1, paymentScope: 1, capturedAt: -1 });
paymentSchema.index({ appointment: 1, capturedAt: -1 });
paymentSchema.index({ cashSession: 1, capturedAt: -1 });

module.exports = mongoose.model("Payment", paymentSchema);
