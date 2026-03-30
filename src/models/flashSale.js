const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const flashSaleSchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      default: "Flash Sale",
    },
    description: {
      type: String,
      trim: true,
    },
    startDate: {
      type: Date,
      required: true,
      description: "Date and time when the flash sale starts",
    },
    endDate: {
      type: Date,
      required: true,
      description: "Date and time when the flash sale ends",
    },
    discountPercentage: {
      type: Number,
      required: true,
      min: 1,
      max: 100,
      validate: {
        validator: function (v) {
          return v > 0 && v <= 100;
        },
        message: "Discount percentage must be between 1 and 100",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Update timestamp on save
flashSaleSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Validate that end date is after start date
flashSaleSchema.pre("save", function (next) {
  if (this.startDate && this.endDate) {
    if (this.endDate <= this.startDate) {
      return next(new Error("End date must be after start date"));
    }
  }
  next();
});

// Index for efficient queries
flashSaleSchema.index({ business: 1, isActive: 1 });
flashSaleSchema.index({ startDate: 1, endDate: 1 });
flashSaleSchema.index({ business: 1, startDate: 1, endDate: 1 });

// Virtual for checking if flash sale is currently active
flashSaleSchema.virtual("isCurrentlyActive").get(function () {
  if (!this.isActive) return false;

  const now = new Date();
  return now >= this.startDate && now <= this.endDate;
});

// Method to check if a specific date/time is within flash sale period
flashSaleSchema.methods.isDateInFlashSale = function (date) {
  if (!this.isActive) return false;

  const checkDate = new Date(date);
  return checkDate >= this.startDate && checkDate <= this.endDate;
};

// Method to calculate discounted price
flashSaleSchema.methods.calculateDiscountedPrice = function (originalPrice) {
  const discountAmount = (originalPrice * this.discountPercentage) / 100;
  return Math.round((originalPrice - discountAmount) * 100) / 100; // Round to 2 decimal places
};

// Static method to find active flash sales for a business
flashSaleSchema.statics.findActiveFlashSales = function (
  businessId,
  date = new Date()
) {
  const query = {
    business: businessId,
    isActive: true,
    startDate: { $lte: date },
    endDate: { $gte: date },
  };

  return this.find(query);
};

// Static method to find all flash sales for a business (active and inactive)
flashSaleSchema.statics.findBusinessFlashSales = function (businessId) {
  return this.find({ business: businessId }).sort({ startDate: -1 });
};

module.exports = mongoose.model("FlashSale", flashSaleSchema);
