const buildPlanLimitFields = () => ({
  maxStaff: {
    type: Number,
    default: null,
    min: 0,
  },
  maxLocations: {
    type: Number,
    default: null,
    min: 0,
  },
  monthlyCampaignRecipients: {
    type: Number,
    default: null,
    min: 0,
  },
  smsCreditsIncluded: {
    type: Number,
    default: null,
    min: 0,
  },
  emailCreditsIncluded: {
    type: Number,
    default: null,
    min: 0,
  },
});

module.exports = {
  buildPlanLimitFields,
};
