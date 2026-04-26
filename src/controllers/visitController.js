const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const { getVisitsForOwner } = require("../services/visit/visitReadService");

const getBusinessVisits = async (req, res) => {
  try {
    const payload = await getVisitsForOwner(req.user.id, req.query);
    return SuccessHandler(payload, 200, res);
  } catch (error) {
    console.error("Get business visits error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

module.exports = {
  getBusinessVisits,
};
