const logger = require("../functions/logger");
const { sendErrorResponse } = require("./apiResponse");

const ErrorHandler = (message, statusCode, req, res) => {
  logger.error({
    method: req.method,
    url: req.url,
    date: new Date(),
    message: message,
  });
  return sendErrorResponse(res, { statusCode, message });
};

module.exports = ErrorHandler;
