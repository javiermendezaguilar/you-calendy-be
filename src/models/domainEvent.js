const mongoose = require("mongoose");

const domainEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      default: () => new mongoose.Types.ObjectId().toString(),
    },
    idempotencyKey: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      index: true,
    },
    occurredAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    recordedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    actorType: {
      type: String,
      required: true,
      default: "user",
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    source: {
      type: String,
      required: true,
      default: "api",
    },
    correlationId: {
      type: String,
      default: "",
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: false,
  }
);

domainEventSchema.index({ shopId: 1, occurredAt: -1 });
domainEventSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $exists: true } },
  }
);

module.exports = mongoose.model("DomainEvent", domainEventSchema);
