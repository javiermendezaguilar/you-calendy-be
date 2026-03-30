const Joi = require("joi");
const createMatchValidation = Joi.object({
  leagueId: Joi.string().required(),
  matchData: Joi.array()
    .items(
      Joi.object({
        venue: Joi.string().required(),
        teams: Joi.array()
          .items(Joi.string().required())
          .unique()
          .length(2)
          .required(),
        date: Joi.date().required(),
        time: Joi.string().required(),
      })
    )
    .min(1)
    .required(),
});

module.exports = {
  createMatchValidation,
};
