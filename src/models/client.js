const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Schema = mongoose.Schema;

const clientSchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      // index: true,
    },
    staff: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      description: "Staff member associated with this client",
    },
    firstName: {
      type: String,
      required: false,
      trim: true,
    },
    lastName: {
      type: String,
      required: false,
      trim: true,
    },
    email: {
      type: String,
      required: false,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },
    profileImage: {
      type: String,
      trim: true,
      description: "URL to client's profile image",
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },
    // Normalized version for reliable matching (last 10 digits/subscriber part)
    phoneComparable: {
      type: String,
      index: true,
    },
    // Registration status to distinguish between unregistered, pending, and registered clients
    registrationStatus: {
      type: String,
      enum: ["unregistered", "pending", "registered"],
      default: "unregistered",
      description: "unregistered: internal contact only, pending: invitation sent, registered: fully verified account"
    },
    // Flag to track if client has accepted terms and conditions
    hasAcceptedTerms: {
      type: Boolean,
      default: false,
    },
    termsAcceptedAt: {
      type: Date,
      default: null,
    },
    // For unregistered clients - internal use only
    internalNotes: {
      type: String,
      trim: true,
      description: "Internal notes for unregistered clients - business use only",
    },
    // Photos of haircuts for unregistered clients
    haircutPhotos: [{
      url: {
        type: String,
        trim: true,
      },
      description: {
        type: String,
        trim: true,
      },
      uploadedAt: {
        type: Date,
        default: Date.now,
      },
    }],
    isProfileComplete: {
      type: Boolean,
      default: false,
      description:
        "Whether the client has completed their profile with all required details",
    },
    notes: {
      type: String,
      trim: true,
      description: "General notes about the client",
    },
    privateNotes: {
      type: String,
      trim: true,
      description: "Private notes only visible to the business owner/staff",
    },
    // Incident notes for tracking no-shows and other issues
    incidentNotes: [{
      date: {
        type: Date,
        default: Date.now,
      },
      type: {
        type: String,
        enum: ['no-show', 'late', 'cancellation', 'other'],
        default: 'no-show',
      },
      appointmentId: {
        type: Schema.Types.ObjectId,
        ref: 'Appointment',
      },
      note: {
        type: String,
        required: true,
        trim: true,
      },
      serviceName: {
        type: String,
        trim: true,
      },
      createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    }],
    preferences: {
      haircutStyle: {
        type: String,
        trim: true,
      },
      preferredStaff: {
        type: Schema.Types.ObjectId,
        ref: "Staff",
      },
      specialInstructions: {
        type: String,
        trim: true,
      },
    },
    invitationToken: {
      type: String,
      unique: true,
      sparse: true,
      description: "Unique token for client invitation link",
    },
    notificationsEnabled: {
      type: Boolean,
      default: true,
      description: "Whether the client wants to receive notifications",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["activated", "deactivated"],
      default: "activated",
    },
    // App booking block status for no-shows
    appBookingBlocked: {
      type: Boolean,
      default: false,
      description: "Whether the client is temporarily blocked from app bookings due to no-shows",
    },
    lastNoShowDate: {
      type: Date,
      default: null,
      description: "The date of the last unexcused no-show",
    },
    blockAppliedDate: {
      type: Date,
      default: null,
      description: "The date the booking block was applied",
    },
    password: {
      type: String,
      select: false, // Don't include password in queries by default
    },
    passwordResetToken: {
      type: Number,
    },
    passwordResetTokenExpires: {
      type: Date,
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

// Index for searching
clientSchema.index({
  firstName: "text",
  lastName: "text",
  email: "text",
  phone: "text",
});

// Compound index for business and email to ensure unique emails per business (only when email exists)
// clientSchema.index(
//   { business: 1, email: 1 },
//   {
//     unique: true,
//     partialFilterExpression: { email: { $exists: true, $type: "string" } },
//   }
// );

// Compound index for business and phone to ensure unique phones per business
// clientSchema.index({ business: 1, phone: 1 }, { unique: true });
// Index for invitation token for fast lookups
clientSchema.index({ invitationToken: 1 });

// Index for phone number lookups (for converting unregistered to registered)
clientSchema.index({ phoneComparable: 1, business: 1 });

// Index for email lookups (for converting unregistered to registered)
clientSchema.index({ email: 1, business: 1 });

// Pre-save middleware to check if profile is complete and normalize phone
clientSchema.pre("save", function (next) {
  // Profile is complete if firstName, lastName, and email are all present
  this.isProfileComplete = !!(this.firstName && this.lastName && this.email);
  
  // Normalize phone for comparison (last 10 digits digits only)
  if (this.phone) {
    const cleaned = String(this.phone).replace(/\D/g, '');
    this.phoneComparable = cleaned.length > 10 ? cleaned.slice(-10) : cleaned;
  }
  
  next();
});

// Hash password before saving
clientSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// JWT token generation for client authentication
clientSchema.methods.getJWTToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      type: 'client',
      businessId: this.business
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRE || "7d",
    }
  );
};

// Compare password method
clientSchema.methods.comparePassword = async function (enteredPassword) {
  if (!this.password) {
    return false;
  }
  return await bcrypt.compare(enteredPassword, this.password);
};

// Method to convert unregistered client to registered
clientSchema.methods.convertToRegistered = async function (password, acceptedTerms = true) {
  // Only allow conversion if client is currently unregistered or pending
  if (this.registrationStatus === 'registered') {
    throw new Error('Client is already registered');
  }

  // Set password
  if (password) {
    this.password = password;
  }

  // Update registration status
  this.registrationStatus = 'registered';
  this.hasAcceptedTerms = acceptedTerms;

  if (acceptedTerms) {
    this.termsAcceptedAt = new Date();
  }

  // Generate invitation token for initial login
  if (!this.invitationToken) {
    this.invitationToken = require('crypto').randomBytes(32).toString('hex');
  }

  return await this.save();
};

// Static method to find or create unregistered client
clientSchema.statics.findOrCreateUnregistered = async function (businessId, clientData) {
  const { phone, email, firstName, lastName } = clientData;

  // Try to find existing client by phone or email
  let query = { business: businessId };

  if (email && phone) {
    const { getComparablePhone } = require('../utils/index');
    const comparablePhone = getComparablePhone(phone);
    query.$or = [
      { phoneComparable: comparablePhone },
      { email: email.toLowerCase() }
    ];
  } else if (phone) {
    const { getComparablePhone } = require('../utils/index');
    query.phoneComparable = getComparablePhone(phone);
  } else if (email) {
    query.email = email.toLowerCase();
  }

  let client = await this.findOne(query);

  if (client) {
    // If found, update with any new information provided
    if (firstName && !client.firstName) client.firstName = firstName;
    if (lastName && !client.lastName) client.lastName = lastName;
    if (email && !client.email) client.email = email.toLowerCase();
    if (phone && !client.phone) client.phone = phone;

    await client.save();
    return { client, isNew: false };
  }

  // Create new unregistered client
  client = new this({
    business: businessId,
    firstName: firstName || '',
    lastName: lastName || '',
    phone: phone,
    email: email ? email.toLowerCase() : undefined,
    registrationStatus: 'unregistered',
    hasAcceptedTerms: false,
  });

  await client.save();
  return { client, isNew: true };
};

const Client = mongoose.models.Client || mongoose.model("Client", clientSchema);

module.exports = Client;
