const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const validator = require("validator");
const userSchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    validate(value) {
      if (!validator.isEmail(value)) {
        throw new Error("Invalid Email");
      }
    },
  },
  password: {
    type: String,
    // required: true,
    //validation will be before saving to db
  },
  phone: {
    type: String,
    unique: true,
    sparse: true, // Allows multiple documents to have a null/missing phone field
  },
  privateNotes: {
    type: String,
    default: null,
  },

  role: {
    type: String,
    enum: ["barber", "admin", "sub-admin"],
    default: "barber",
  },
  status: {
    type: String,
    enum: ["activated", "deactivated"],
    default: "activated",
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now(),
  },
  passwordResetToken: {
    type: Number,
  },
  passwordResetTokenExpires: {
    type: Date,
  },
  lastLogin: {
    type: Date,
  },
  provider: {
    type: String,
    default: "app",
  },
  profileImage: {
    type: String,
    default: null,
  },
  country: {
    type: String,
    // required: true,
  },
  language: {
    type: String,
    default: "en",
    description: "Preferred language code (e.g., en, es, fr, etc.)",
  },
  zip: {
    type: String,
    // required: true,
  },
  deviceToken: {
    type: String,
    default: null,
  },
  isNotificationEnabled: {
    type: Boolean,
    default: true,
  },
  // Notification settings for different types of notifications
  notificationSettings: {
    barberRegistration: {
      type: Boolean,
      default: true,
      description: "Notifications when a barber registers",
    },
    subscriptionExpiry: {
      type: Boolean,
      default: true,
      description:
        "Notifications when barber's subscription is about to expire or has been canceled",
    },
    bookingSpike: {
      type: Boolean,
      default: true,
      description:
        "Notifications when barber experiences a sudden spike in bookings that may need support",
    },
  },
  // Pending penalties to be applied to future appointments
  pendingPenalties: [
    {
      business: {
        type: Schema.Types.ObjectId,
        ref: "Business",
        required: true,
      },
      amount: {
        type: Number,
        required: true,
        min: 0,
      },
      reason: {
        type: String,
        enum: ["no-show"],
        required: true,
      },
      appointmentId: {
        type: Schema.Types.ObjectId,
        ref: "Appointment",
        required: true,
      },
      appliedDate: {
        type: Date,
        default: Date.now,
      },
      applied: {
        type: Boolean,
        default: false,
      },
      appliedToAppointment: {
        type: Schema.Types.ObjectId,
        ref: "Appointment",
      },
    },
  ],
  permissions: {
    type: String,
    enum: ["complete access", "management access", "support only"],
    default: "support only",
    description: "Permission level for sub-admins.",
  },
});

//hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

//jwtToken
userSchema.methods.getJWTToken = function () {
  return jwt.sign({ _id: this._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });
};

//compare password
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const user = mongoose.model("User", userSchema);

module.exports = user;
