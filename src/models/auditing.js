const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const auditingSchema = new Schema(
  {
    entityType: {
      type: String,
      required: true,
      enum: ["Staff", "Client", "Business", "Service", "Appointment", "Other"],
    },
    entityId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: ["deleted", "updated", "created", "modified", "other"],
    },
    reason: {
      type: String,
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
auditingSchema.index({ entityType: 1, entityId: 1 });
auditingSchema.index({ createdAt: -1 });

// Additional indexes for search functionality
auditingSchema.index({ reason: "text" }); // Text index for reason field
auditingSchema.index({ action: 1 }); // Index for action field
auditingSchema.index({ entityType: 1, action: 1 }); // Compound index for entityType + action
auditingSchema.index({ createdAt: -1, entityType: 1 }); // Compound index for date + entityType
auditingSchema.index({ "metadata.staffName": 1 }); // Index for staff name in metadata
auditingSchema.index({ "metadata.clientName": 1 }); // Index for client name in metadata

const Auditing = mongoose.models.Auditing || mongoose.model("Auditing", auditingSchema);

module.exports = Auditing;
