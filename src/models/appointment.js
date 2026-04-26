const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const {
  getSemanticStateFromLegacyStatus,
} = require("../services/appointment/stateService");
const {
  buildPolicySnapshotFromBusiness,
} = require("../services/appointment/policyService");
const { buildPolicySnapshotFields } = require("./policySchemaFields");

const appointmentSchema = new Schema(
  {
    client: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    service: {
      type: Schema.Types.ObjectId,
      ref: "Service", // Reference to service model
      required: true,
    },
    staff: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      default: null, // An appointment might not have a specific staff member
    },
    date: {
      type: Date,
      required: true,
    },
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
    duration: {
      type: Number, // Duration in minutes
      required: true,
    },
    status: {
      type: String,
      enum: [
        "Pending",
        "Confirmed",
        "Canceled",
        "Completed",
        "No-Show",
        "Missed",
      ],
      default: "Pending",
    },
    bookingStatus: {
      type: String,
      enum: ["booked", "confirmed", "rescheduled", "cancelled"],
      default: "booked",
    },
    visitStatus: {
      type: String,
      enum: [
        "not_started",
        "checked_in",
        "in_service",
        "completed",
        "no_show",
        "cancelled",
      ],
      default: "not_started",
    },
    visitType: {
      type: String,
      enum: ["appointment", "walk_in"],
      default: "appointment",
    },
    queuePosition: {
      type: Number,
      default: null,
      min: 1,
    },
    estimatedWaitMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    queueStatus: {
      type: String,
      enum: [
        "none",
        "waiting",
        "called",
        "in_service",
        "completed",
        "abandoned",
        "cancelled",
      ],
      default: "none",
    },
    queuePriority: {
      type: Number,
      default: 0,
    },
    queueEnteredAt: {
      type: Date,
      default: null,
    },
    queueLeftAt: {
      type: Date,
      default: null,
    },
    queueOutcomeReason: {
      type: String,
      default: "",
    },
    queueOutcomeNote: {
      type: String,
      default: "",
    },
    policySnapshot: buildPolicySnapshotFields(),
    notes: {
      type: String,
      default: "",
    },
    clientNotes: {
      type: String,
      default: "",
    },
    referencePhotos: [
      {
        url: String,
        public_id: String,
      },
    ],
    personalization: {
      pastHaircut: {
        type: String,
        default: "",
      },
      instructions: {
        type: String,
        default: "",
      },
      photos: [
        {
          url: String,
          public_id: String,
        },
      ],
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Partially Refunded", "Refunded", "Failed"],
      default: "Pending",
    },
    operationalTimestamps: {
      checkedInAt: {
        type: Date,
        default: null,
      },
      checkedInBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      serviceStartedAt: {
        type: Date,
        default: null,
      },
      serviceStartedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
    price: {
      type: Number,
      required: true,
    },
    penalty: {
      applied: {
        type: Boolean,
        default: false,
      },
      amount: {
        type: Number,
        default: 0,
      },
      paid: {
        type: Boolean,
        default: false,
      },
      paidDate: {
        type: Date,
      },
      type: {
        type: String,
        enum: ["none", "no_show", "late_cancel", "manual"],
        default: "none",
      },
      source: {
        type: String,
        enum: ["policy_snapshot", "manual"],
        default: "policy_snapshot",
      },
      waived: {
        type: Boolean,
        default: false,
      },
      waivedReason: {
        type: String,
        default: "",
      },
      assessedAt: {
        type: Date,
        default: null,
      },
      assessedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      notes: {
        type: String,
        default: "",
      },
    },
    policyOutcome: {
      type: {
        type: String,
        enum: ["none", "no_show", "late_cancel"],
        default: "none",
      },
      reason: {
        type: String,
        default: "",
      },
      note: {
        type: String,
        default: "",
      },
      decidedAt: {
        type: Date,
        default: null,
      },
      decidedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      waived: {
        type: Boolean,
        default: false,
      },
      waiverReason: {
        type: String,
        default: "",
      },
      feeApplied: {
        type: Boolean,
        default: false,
      },
      feeAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
      blockApplied: {
        type: Boolean,
        default: false,
      },
      policySource: {
        type: String,
        default: "",
      },
      policyVersion: {
        type: Number,
        default: 0,
      },
      scheduledStartAt: {
        type: Date,
        default: null,
      },
    },
    reminderSent: {
      type: Boolean,
      default: false,
    },
    delay: {
      notified: {
        type: Boolean,
        default: false,
      },
      message: {
        type: String,
        default: "",
      },
      notifiedAt: {
        type: Date,
      },
      estimatedDelay: {
        type: Number, // Delay in minutes (legacy)
        default: 0,
      },
      // New fields for rescheduling
      newDate: {
        type: Date,
        default: null,
      },
      newStartTime: {
        type: String,
        default: null,
      },
      newEndTime: {
        type: String,
        default: null,
      },
    },
    // Promotion information
    promotion: {
      applied: {
        type: Boolean,
        default: false,
      },
      promotionId: {
        type: Schema.Types.ObjectId,
        ref: "Promotion",
      },
      originalPrice: {
        type: Number,
        default: 0,
      },
      discountAmount: {
        type: Number,
        default: 0,
      },
      discountPercentage: {
        type: Number,
        default: 0,
      },
    },
    // Flash Sale information
    flashSale: {
      applied: {
        type: Boolean,
        default: false,
      },
      flashSaleId: {
        type: Schema.Types.ObjectId,
        ref: "FlashSale",
      },
      originalPrice: {
        type: Number,
        default: 0,
      },
      discountAmount: {
        type: Number,
        default: 0,
      },
      discountPercentage: {
        type: Number,
        default: 0,
      },
    },
    rebookingOrigin: {
      checkout: {
        type: Schema.Types.ObjectId,
        ref: "Checkout",
        default: null,
      },
      appointment: {
        type: Schema.Types.ObjectId,
        ref: "Appointment",
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
    },
    reminderTime: {
      type: String,
      enum: [
        "1_hour_before",
        "2_hours_before",
        "3_hours_before",
        "4_hours_before",
        null,
      ],
      default: null,
      description: "When to send the reminder before the appointment",
    },
    appointmentReminder: {
      type: Boolean,
      default: false,
      description:
        "Whether appointment reminder is enabled for this appointment",
    },
    messageReminder: {
      type: String,
      default: "",
      description: "The message to send as a reminder",
    },
    // Review request information
    reviewRequest: {
      sent: {
        type: Boolean,
        default: false,
        description:
          "Whether a review request SMS was sent for this appointment",
      },
      message: {
        type: String,
        default: "",
        description: "The review request message that was sent via SMS",
      },
      sentAt: {
        type: Date,
        default: null,
        description: "When the review request SMS was sent",
      },
      sentBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
        description: "The business owner who sent the review request",
      },
      error: {
        type: String,
        default: null,
        description: "Error code or type if SMS sending failed",
      },
      errorMessage: {
        type: String,
        default: null,
        description: "Human-readable error message if SMS sending failed",
      },
    },
  },
  { timestamps: true }
);

// Virtual field for full date time
appointmentSchema.virtual("dateTime").get(function () {
  const [hours, minutes] = this.startTime.split(":");
  const appointmentDate = new Date(this.date);
  appointmentDate.setHours(parseInt(hours, 10));
  appointmentDate.setMinutes(parseInt(minutes, 10));
  return appointmentDate;
});

// Index for efficient queries
// appointmentSchema.index({ business: 1, date: 1 });
// appointmentSchema.index({ client: 1, date: 1 });
// appointmentSchema.index({ status: 1 });

appointmentSchema.statics.getSemanticStateFromLegacyStatus = function (
  status,
  overrides = {}
) {
  return getSemanticStateFromLegacyStatus(status, overrides);
};

appointmentSchema.statics.buildPolicySnapshot = function (business) {
  return buildPolicySnapshotFromBusiness(business);
};

module.exports = mongoose.model("Appointment", appointmentSchema);
