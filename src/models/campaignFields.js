const buildSkippedRecipientDefinition = (Schema) => ({
  client: {
    type: Schema.Types.ObjectId,
    ref: "Client",
  },
  reason: {
    type: String,
    trim: true,
  },
});

const buildCampaignMetadataDefinition = (Schema) => ({
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
  skippedRecipients: [buildSkippedRecipientDefinition(Schema)],
});

const buildCampaignFields = (Schema, options = {}) => {
  const fields = {
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
    scheduledDate: {
      type: Date,
      default: null,
    },
    recurringInterval: {
      type: Number,
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
    lastSentAt: {
      type: Date,
      default: null,
    },
    nextScheduledAt: {
      type: Date,
      default: null,
    },
    metadata: buildCampaignMetadataDefinition(Schema),
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  };

  if (options.includeImageUrl) {
    fields.imageUrl = {
      type: String,
      default: null,
    };
  }

  return fields;
};

const applyCampaignIndexesAndHooks = (schema) => {
  schema.index({ business: 1, status: 1 });
  schema.index({ business: 1, deliveryType: 1 });
  schema.index({ scheduledDate: 1, status: "scheduled" });
  schema.index({ nextScheduledAt: 1, status: "scheduled" });

  schema.pre("save", function (next) {
    this.updatedAt = Date.now();
    next();
  });
};

module.exports = {
  applyCampaignIndexesAndHooks,
  buildCampaignFields,
  buildCampaignMetadataDefinition,
};
