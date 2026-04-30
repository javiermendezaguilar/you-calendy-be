const mongoose = require("mongoose");
const {
  applyCampaignIndexesAndHooks,
  buildCampaignFields,
} = require("./campaignFields");

const Schema = mongoose.Schema;

const smsCampaignSchema = new Schema(buildCampaignFields(Schema), {
  timestamps: true,
});

applyCampaignIndexesAndHooks(smsCampaignSchema);

module.exports = mongoose.model("SmsCampaign", smsCampaignSchema);
