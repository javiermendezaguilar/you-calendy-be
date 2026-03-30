const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const supportSchema = new Schema(
  {
    barber: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },

    issueDescription: {
      type: String,
      required: true,
      trim: true,
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Low",
    },
    status: {
      type: String,
      enum: ["pending", "resolved", "completed"],
      default: "pending",
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// Index for efficient queries
supportSchema.index({ barber: 1, createdAt: -1 });
supportSchema.index({ priority: 1 });
supportSchema.index({ status: 1 });
supportSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Support", supportSchema);
