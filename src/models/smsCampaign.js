const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const smsCampaignSchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
    },
    deliveryType: {
      type: String,
      enum: ["send_now", "send_later", "recurring"],
      required: true,
    },
    // For send_later type
    scheduledDate: {
      type: Date,
      default: null,
    },
    // For recurring type
    recurringInterval: {
      type: Number, // Days after last visit
      default: null,
      min: 1,
    },

    status: {
      type: String,
      enum: ["draft", "scheduled", "sent", "failed", "cancelled"],
      default: "draft",
    },
    sentAt: {
      type: Date,
      default: null,
    },
    sentTo: {
      type: String,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    // For recurring campaigns - track when it was last sent
    lastSentAt: {
      type: Date,
      default: null,
    },
    // For recurring campaigns - track next scheduled send
    nextScheduledAt: {
      type: Date,
      default: null,
    },
    // Campaign metadata
    metadata: {
      totalSent: {
        type: Number,
        default: 0,
      },
      totalFailed: {
        type: Number,
        default: 0,
      },
      creditsUsed: {
        type: Number,
        default: 0,
      },
      creditsRefunded: {
        type: Number,
        default: 0,
      },
      totalSkipped: {
        type: Number,
        default: 0,
      },
      skippedRecipients: [
        {
          client: {
            type: Schema.Types.ObjectId,
            ref: "Client",
          },
          reason: {
            type: String,
            trim: true,
          },
        },
      ],
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
smsCampaignSchema.index({ business: 1, status: 1 });
smsCampaignSchema.index({ business: 1, deliveryType: 1 });
smsCampaignSchema.index({ scheduledDate: 1, status: "scheduled" });
smsCampaignSchema.index({ nextScheduledAt: 1, status: "scheduled" });

// Update timestamp on save
smsCampaignSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("SmsCampaign", smsCampaignSchema);
