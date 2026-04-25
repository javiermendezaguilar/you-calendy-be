const mongoose = require("mongoose");

const capacityLockSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    lockKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      default: null,
      index: true,
    },
    dateKey: {
      type: String,
      required: true,
      index: true,
    },
    version: {
      type: Number,
      default: 0,
    },
    touchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

capacityLockSchema.index({ business: 1, staff: 1, dateKey: 1 });

module.exports = mongoose.model("CapacityLock", capacityLockSchema);
