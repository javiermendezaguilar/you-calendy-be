const { z } = require("zod");
const ErrorHandler = require("../utils/ErrorHandler");

const formatIssuePath = (path) => (path.length ? path.join(".") : "request");

const formatValidationMessage = (issues) => {
  const details = issues
    .slice(0, 3)
    .map((issue) => `${formatIssuePath(issue.path)} ${issue.message}`)
    .join("; ");

  return details ? `Invalid request: ${details}` : "Invalid request";
};

const parseSection = ({ schema, value, req, res, assign }) => {
  if (!schema) return true;

  const result = schema.safeParse(value);
  if (!result.success) {
    ErrorHandler(formatValidationMessage(result.error.issues), 400, req, res);
    return false;
  }

  assign(result.data);
  return true;
};

const validateRequest = ({ params, query, body } = {}) => (req, res, next) => {
  const sections = [
    {
      schema: params,
      value: req.params,
      assign: (data) => {
        req.params = data;
      },
    },
    {
      schema: query,
      value: req.query,
      assign: (data) => {
        req.query = data;
      },
    },
    {
      schema: body,
      value: req.body,
      assign: (data) => {
        req.body = data;
      },
    },
  ];

  for (const section of sections) {
    if (!parseSection({ ...section, req, res })) {
      return;
    }
  }

  return next();
};

module.exports = {
  validateRequest,
  z,
};
