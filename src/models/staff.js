const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const workingHoursSchema = new Schema(
  {
    day: {
      type: String,
      enum: [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ],
      required: true,
    },
    enabled: { type: Boolean, default: true },
    shifts: [
      {
        start: { type: String, required: true }, // "09:00"
        end: { type: String, required: true }, // "17:00"
        breaks: [
          {
            start: { type: String, required: true }, // "12:00"
            end: { type: String, required: true }, // "13:00"
            // description: { type: String, default: "Break" }, // "Lunch Break"
          },
        ],
      },
    ],
  },
  { _id: false }
);

const staffSchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: undefined,
      index: true,
    },
    firstName: {
      type: String,
      required: [true, "First name is required"],
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
    },
    email: {
      type: String,
      // required: [true, 'Email is required'], // Staff might not have an email
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
    },
    role: {
      // Corresponds to 'staffer' from frontend
      type: String,
      default: "Staff",
    },
    position: {
      // Corresponds to 'position' from frontend
      type: String,
    },
    services: [
      {
        service: {
          type: Schema.Types.ObjectId,
          ref: "Service",
          required: true,
        },
        timeInterval: {
          type: Number,
          required: true,
          min: 5, // Minimum 5 minutes
          max: 120, // Maximum 2 hours
          description: "Time interval for this specific service in minutes",
        },
      },
    ],
    workingHours: [workingHoursSchema],
    timeInterval: {
      type: Number,
      default: 15, // Default 15 minutes between appointments
      min: 5, // Minimum 5 minutes
      max: 120, // Maximum 2 hours
      description:
        "Default time interval between appointments in minutes (used when no service-specific interval is set)",
    },
    bookingBuffer: {
      type: Number,
      default: 0, // Default no buffer - allow immediate booking
      min: 0, // Minimum 0 minutes
      max: 1440, // Maximum 24 hours (1440 minutes)
      description:
        "Minimum advance booking time in minutes (prevents last-minute bookings)",
    },
    showInCalendar: {
      type: Boolean,
      default: true,
    },
    availableForBooking: {
      type: Boolean,
      default: true,
    },
    profileImage: {
      type: String,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// To make searching easier
staffSchema.index({ firstName: "text", lastName: "text", email: "text" });
staffSchema.index(
  { business: 1, user: 1 },
  {
    unique: true,
    partialFilterExpression: { user: { $exists: true } },
  }
);

const Staff = mongoose.model("Staff", staffSchema);

module.exports = Staff;
