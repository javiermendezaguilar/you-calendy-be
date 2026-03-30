const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const suggestionSchema = new Schema(
  {
    note: { type: String, required: true },
    imageUrl: { type: String, trim: true },
    imagePublicId: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "Client" },
  // Barber response to a suggestion (optional)
  response: { type: String, trim: true },
  respondedBy: { type: Schema.Types.ObjectId, ref: "User" },
  respondedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  }
);

const reportSchema = new Schema(
  {
    note: { type: String, required: true },
    imageUrl: { type: String, trim: true },
    imagePublicId: { type: String },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: "Rating must be a whole number between 1 and 5",
      },
    },
    reportType: { type: String, default: "other" },
    createdBy: { type: Schema.Types.ObjectId, ref: "Client" },
    status: { type: String, default: "pending" },
    reviewNote: { type: String },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  }
);

const haircutGallerySchema = new Schema(
  {
    business: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    client: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true,
    },
    staff: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
    },
    appointment: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    haircutStyle: {
      type: String,
      trim: true,
    },
    imageUrl: {
      type: String,
      required: true,
    },
    imagePublicId: {
      type: String,
    },
    suggestions: [suggestionSchema],
    reports: [reportSchema],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

haircutGallerySchema.index({ business: 1, client: 1, isActive: 1 });
haircutGallerySchema.index({ client: 1, isActive: 1 });
haircutGallerySchema.index({ staff: 1 });
haircutGallerySchema.index({ appointment: 1 });

const HaircutGallery = mongoose.model("HaircutGallery", haircutGallerySchema);

module.exports = HaircutGallery;
