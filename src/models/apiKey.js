const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const apiKeySchema = new Schema(
  {
    googleAnalyticsApiKey: {
      type: String,
      description: "Google Analytics API key",
    },
    nodemailerApiKey: {
      type: String,
      description: "Nodemailer API key",
    },
    isActive: {
      type: Boolean,
      default: true,
      description: "Whether this API key configuration is currently active",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      description: "User who created/updated this API key configuration",
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      description: "User who last updated this API key configuration",
    },
    lastUsed: {
      type: Date,
      description: "Timestamp of when any key was last used",
    },
    usageCount: {
      type: Number,
      default: 0,
      description: "Number of times any key has been used",
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
      description: "Additional metadata about the API keys",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Index for efficient queries
apiKeySchema.index({ isActive: 1 });

// Virtual for masking the Google Analytics API key value in responses
apiKeySchema.virtual("maskedGoogleAnalyticsApiKey").get(function () {
  if (!this.googleAnalyticsApiKey) return null;
  const length = this.googleAnalyticsApiKey.length;
  if (length <= 8) return "*".repeat(length);
  return (
    this.googleAnalyticsApiKey.substring(0, 4) +
    "*".repeat(length - 8) +
    this.googleAnalyticsApiKey.substring(length - 4)
  );
});

// Virtual for masking the Nodemailer API key value in responses
apiKeySchema.virtual("maskedNodemailerApiKey").get(function () {
  if (!this.nodemailerApiKey) return null;
  const length = this.nodemailerApiKey.length;
  if (length <= 8) return "*".repeat(length);
  return (
    this.nodemailerApiKey.substring(0, 4) +
    "*".repeat(length - 8) +
    this.nodemailerApiKey.substring(length - 4)
  );
});

// Method to update usage statistics
apiKeySchema.methods.updateUsage = function () {
  this.lastUsed = new Date();
  this.usageCount += 1;
  return this.save();
};

// Static method to get active API key configuration
apiKeySchema.statics.getActiveConfig = function () {
  return this.findOne({ isActive: true });
};

// Static method to create or update API key configuration
apiKeySchema.statics.createOrUpdateConfig = function (configData, userId) {
  return this.findOneAndUpdate(
    { isActive: true },
    {
      ...configData,
      isActive: true,
      updatedBy: userId,
      $setOnInsert: { createdBy: userId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

// Static method to get specific API key
apiKeySchema.statics.getApiKey = function (keyType) {
  return this.findOne({ isActive: true }).select(keyType);
};

const ApiKey = mongoose.model("ApiKey", apiKeySchema);

module.exports = ApiKey;
