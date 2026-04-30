const mongoose = require("mongoose");
const {
  applyCampaignIndexesAndHooks,
  buildCampaignFields,
} = require("./campaignFields");

const Schema = mongoose.Schema;

const emailCampaignSchema = new Schema(
  buildCampaignFields(Schema, { includeImageUrl: true }),
  { timestamps: true }
);

applyCampaignIndexesAndHooks(emailCampaignSchema);

module.exports = mongoose.model("EmailCampaign", emailCampaignSchema);
