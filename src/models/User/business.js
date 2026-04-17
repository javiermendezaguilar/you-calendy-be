const mongoose = require("mongoose");

const businessSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  personalName: {
    type: String,
    trim: true,
  },
  surname: {
    type: String,
    trim: true,
  },
  name: {
    type: String,
    trim: true,
  },
  contactInfo: {
    email: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    publicUrl: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
  },
  socialMedia: {
    facebook: {
      type: String,
      trim: true,
    },
    instagram: {
      type: String,
      trim: true,
    },
    twitter: {
      type: String,
      trim: true,
    },
    website: {
      type: String,
      trim: true,
    },
    onlineShop: {
      type: String,
      trim: true,
    },
  },
  address: {
    streetName: {
      type: String,
      trim: true,
    },
    houseNumber: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    postalCode: {
      type: String,
      trim: true,
    },
  },
  location: {
    type: {
      type: String,
      default: "Point",
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0],
    },
    address: {
      type: String,
      trim: true,
    },
  },
  businessHours: {
    monday: {
      enabled: { type: Boolean, default: true },
      shifts: [
        {
          start: String,
          end: String,
        },
      ],
    },
    tuesday: {
      enabled: { type: Boolean, default: true },
      shifts: [
        {
          start: String,
          end: String,
        },
      ],
    },
    wednesday: {
      enabled: { type: Boolean, default: true },
      shifts: [
        {
          start: String,
          end: String,
        },
      ],
    },
    thursday: {
      enabled: { type: Boolean, default: true },
      shifts: [
        {
          start: String,
          end: String,
        },
      ],
    },
    friday: {
      enabled: { type: Boolean, default: true },
      shifts: [
        {
          start: String,
          end: String,
        },
      ],
    },
    saturday: {
      enabled: { type: Boolean, default: false },
      shifts: [
        {
          start: String,
          end: String,
        },
      ],
    },
    sunday: {
      enabled: { type: Boolean, default: false },
      shifts: [
        {
          start: String,
          end: String,
        },
      ],
    },
  },
  timeFormatPreference: {
    type: String,
    enum: ["12h", "24h"],
    default: "12h",
  },
  services: [
    {
      name: {
        type: String,
        required: true,
        trim: true,
      },
      type: {
        type: String,
        trim: true,
      },
      price: {
        type: Number,
        default: 0,
      },
      currency: {
        type: String,
        default: "USD",
        enum: [
          "USD",
          "EUR",
          "GBP",
          "CAD",
          "AUD",
          "JPY",
          "CHF",
          "CNY",
          "INR",
          "BRL",
        ],
      },
      isFromEnabled: {
        type: Boolean,
        default: false,
      },
    },
  ],
  profileImages: {
    logo: {
      type: String,
    },
    coverPhoto: {
      type: String,
    },
    workspacePhotos: [String],
    galleryImages: [String],
  },
  // Penalty settings for no-show appointments
  penaltySettings: {
    noShowPenalty: {
      type: Boolean,
      default: false,
    },
    noShowPenaltyAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  // Booking buffer settings
  bookingBuffer: {
    type: Number,
    default: 30, // Default 30 minutes advance booking required
    min: 0, // Minimum 0 minutes (no buffer)
    max: 1440, // Maximum 24 hours (1440 minutes)
    description:
      "Default minimum advance booking time in minutes for the business",
  },
  // Default reminder settings for new appointments
  defaultReminderSettings: {
    appointmentReminder: {
      type: Boolean,
      default: false,
      description: "Default reminder enabled status for new appointments",
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
      description: "Default reminder time for new appointments",
    },
    messageReminder: {
      type: String,
      default: "",
      description: "Default reminder message for new appointments",
    },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  // Freemium/Premium fields
  trialStart: {
    type: Date,
    default: null,
    description: "Start date of the free trial",
  },
  trialEnd: {
    type: Date,
    default: null,
    description: "End date of the free trial",
  },
  trialUsed: {
    type: Boolean,
    default: false,
    description: "Whether the free trial has been used",
  },
  subscriptionStatus: {
    type: String,
    enum: [
      "none",
      "trialing",
      "active",
      "past_due",
      "canceled",
      "unpaid",
      "incomplete",
      "incomplete_expired",
      "paused",
    ],
    default: "none",
    description: "Current Stripe subscription status",
  },
  // Google Business Profile Place ID for direct review links
  googlePlaceId: {
    type: String,
    trim: true,
    default: null,
    description: "Google Place ID for generating direct review links",
  },
  // Direct Google Review URL (if Place ID not available)
  googleReviewUrl: {
    type: String,
    trim: true,
    default: null,
    description: "Direct Google Review URL",
  },
  // Credits wallet for SMS and Email
  smsCredits: {
    type: Number,
    default: 0,
    min: 0,
  },
  emailCredits: {
    type: Number,
    default: 0,
    min: 0,
  },
  stripeCustomerId: {
    type: String,
    default: null,
    description: "Stripe customer ID for this business",
  },
  stripeSubscriptionId: {
    type: String,
    default: null,
    description: "Stripe subscription ID for this business",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update timestamp on save
businessSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

businessSchema.index({ owner: 1 });

// Index for geospatial queries
businessSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Business", businessSchema);
