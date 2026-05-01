const normalizeErrorStatus = (statusCode) => {
  const parsed = Number(statusCode);
  return Number.isInteger(parsed) && parsed >= 400 && parsed <= 599
    ? parsed
    : 500;
};

const normalizeErrorMessage = (message, statusCode) => {
  if (typeof message === "string" && message.trim()) {
    return message;
  }

  if (message && typeof message.message === "string" && message.message.trim()) {
    return message.message;
  }

  return statusCode >= 500 ? "Internal Server Error" : "Request failed";
};

const sendErrorResponse = (res, { statusCode, message }) => {
  const normalizedStatus = normalizeErrorStatus(statusCode);
  const normalizedMessage = normalizeErrorMessage(message, normalizedStatus);

  return res.status(normalizedStatus).json({
    success: false,
    message: normalizedMessage,
  });
};

module.exports = {
  normalizeErrorMessage,
  normalizeErrorStatus,
  sendErrorResponse,
};

