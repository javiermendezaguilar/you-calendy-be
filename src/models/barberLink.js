const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const barberLinkSchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      unique: true, // Each business can only have one barber link
    },
    linkToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    expiresAt: {
      type: Date,
      default: null, // null means no expiration
    },
    accessCount: {
      type: Number,
      default: 0,
    },
    lastAccessedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Index for efficient queries
barberLinkSchema.index({ linkToken: 1 });
barberLinkSchema.index({ business: 1 });
barberLinkSchema.index({ isActive: 1 });

// Pre-save middleware to update lastAccessedAt when accessCount changes
barberLinkSchema.pre("save", function (next) {
  if (this.isModified("accessCount") && this.accessCount > 0) {
    this.lastAccessedAt = new Date();
  }
  next();
});

module.exports = mongoose.model("BarberLink", barberLinkSchema);
