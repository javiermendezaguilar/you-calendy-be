const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const featureSuggestionSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    suggestedBy: {
      type: Schema.Types.ObjectId,
      ref: "Staff", // Assuming barbers are stored in the Staff model
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FeatureSuggestion", featureSuggestionSchema);
