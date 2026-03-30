const mongoose = require("mongoose");
const { Schema } = mongoose;

const billingSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    team: {
      type: Schema.Types.ObjectId,
      ref: "Team",
    },
    league: {
      type: Schema.Types.ObjectId,
      ref: "League",
      default: null,
    },
    invoice: {
      type: String,
    },

    billingDetail: {
      type: Object,
    },
    amount: {
      type: Number,
    },
    type: {
      type: String,
    },
  },
  { timestamps: true }
);

const Billing = mongoose.model("Billing", billingSchema);
module.exports = Billing;
