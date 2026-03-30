const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const promotionSchema = new Schema(
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
      default: "Happy Hours",
    },
    description: {
      type: String,
      trim: true,
    },
    dayOfWeek: {
      type: String,
      required: true,
      enum: [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ],
    },
    startTime: {
      type: String,
      required: true,
      validate: {
        validator: function (v) {
          return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: "Start time must be in HH:MM format",
      },
    },
    endTime: {
      type: String,
      required: true,
      validate: {
        validator: function (v) {
          return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: "End time must be in HH:MM format",
      },
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
    services: [
      {
        type: Schema.Types.ObjectId,
        ref: "Service",
        required: true,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    applyBothDiscounts: {
      type: Boolean,
      default: false,
      description: "If true, both flash sale and promotion discounts apply during happy hour time",
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
promotionSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Validate that end time is after start time
promotionSchema.pre("save", function (next) {
  if (this.startTime && this.endTime) {
    const start = new Date(`2000-01-01T${this.startTime}:00`);
    const end = new Date(`2000-01-01T${this.endTime}:00`);

    if (end <= start) {
      return next(new Error("End time must be after start time"));
    }
  }
  next();
});

// Index for efficient queries
promotionSchema.index({ business: 1, dayOfWeek: 1, isActive: 1 });
promotionSchema.index({ services: 1 });

// Virtual for checking if promotion is currently active
promotionSchema.virtual("isCurrentlyActive").get(function () {
  if (!this.isActive) return false;

  // Check if it's the right day of week
  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const currentDay = days[new Date().getDay()];

  if (currentDay !== this.dayOfWeek) return false;

  // Check if it's within the time range
  const currentTime = new Date().toTimeString().slice(0, 5); // HH:MM format
  return currentTime >= this.startTime && currentTime <= this.endTime;
});

// Method to check if a specific time slot is within promotion hours
promotionSchema.methods.isTimeSlotInPromotion = function (timeSlot) {
  if (!this.isActive) return false;

  const slotTime = timeSlot.slice(0, 5); // Ensure HH:MM format
  return slotTime >= this.startTime && slotTime <= this.endTime;
};

// Method to calculate discounted price
promotionSchema.methods.calculateDiscountedPrice = function (originalPrice) {
  const discountAmount = (originalPrice * this.discountPercentage) / 100;
  return Math.round((originalPrice - discountAmount) * 100) / 100; // Round to 2 decimal places
};

// Static method to find active promotions for a business on a specific day
promotionSchema.statics.findActivePromotions = function (
  businessId,
  dayOfWeek,
  timeSlot = null
) {
  const query = {
    business: businessId,
    dayOfWeek: dayOfWeek,
    isActive: true,
  };

  return this.find(query).populate("services", "name price duration");
};

module.exports = mongoose.model("Promotion", promotionSchema);
