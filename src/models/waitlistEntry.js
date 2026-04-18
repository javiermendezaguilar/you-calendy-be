const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const waitlistEntrySchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    client: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true,
    },
    service: {
      type: Schema.Types.ObjectId,
      ref: "Service",
      required: true,
      index: true,
    },
    staff: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      default: null,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    timeWindowStart: {
      type: String,
      required: true,
    },
    timeWindowEnd: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "matched", "cancelled", "expired"],
      default: "active",
      index: true,
    },
    source: {
      type: String,
      enum: ["manual", "walk_in_overflow", "booking_overflow"],
      default: "manual",
    },
    notes: {
      type: String,
      default: "",
    },
    matchedAppointment: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },
    matchedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

waitlistEntrySchema.index(
  { business: 1, service: 1, date: 1, status: 1, createdAt: 1 },
  { name: "waitlist_search_idx" }
);

module.exports =
  mongoose.models.WaitlistEntry ||
  mongoose.model("WaitlistEntry", waitlistEntrySchema);
