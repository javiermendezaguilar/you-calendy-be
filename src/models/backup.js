const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const backupSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["daily", "weekly", "monthly"],
      required: true,
    },
    filename: {
      type: String,
      required: true,
    },
    cloudinaryUrl: {
      type: String,
      required: true,
    },
    cloudinaryPublicId: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number, // Size in bytes
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["completed", "failed", "in_progress"],
      default: "in_progress",
    },
    // Backup operation progress (for manual backup creation)
    backupStatus: {
      type: String,
      enum: ["idle", "in_progress", "completed", "failed"],
      default: "idle",
    },
    backupProgress: { type: Number, default: 0 }, // 0-100
    backupPhase: { type: String, default: null }, // e.g., initializing, gathering, uploading, finalizing
    backupCurrentCollection: { type: String, default: null },
    backupProcessedCollections: { type: Number, default: 0 },
    backupTotalCollections: { type: Number, default: 0 },

    // Restore operation progress (for restore from backup)
    restoreStatus: {
      type: String,
      enum: ["idle", "in_progress", "completed", "failed"],
      default: "idle",
    },
    restoreProgress: { type: Number, default: 0 }, // 0-100
    restorePhase: { type: String, default: null }, // e.g., downloading, clearing, restoring, finalizing
    restoreCurrentCollection: { type: String, default: null },
    restoreProcessedCollections: { type: Number, default: 0 },
    restoreTotalCollections: { type: Number, default: 0 },
    collections: [
      {
        name: String,
        count: Number,
      },
    ],
    metadata: {
      totalRecords: Number,
      backupDate: Date,
      version: String,
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Index for efficient queries
backupSchema.index({ type: 1, createdAt: -1 });
backupSchema.index({ status: 1 });
backupSchema.index({ createdBy: 1 });

module.exports = mongoose.model("Backup", backupSchema);
