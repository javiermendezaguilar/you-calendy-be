const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const Transport = require("nodemailer-brevo-transport");
const sanitizeHtml = require("sanitize-html");
const ApiKey = require("../models/apiKey");

dotenv.config({ path: "./src/config/config.env" });

const EMAIL_PROVIDER = "brevo";
const DEFAULT_FROM_EMAIL = "no-reply@groomnest.com";
const DEFAULT_FROM_NAME = "Groomnest";
const RETRYABLE_BREVO_STATUSES = new Set([429, 500, 502, 503, 504]);
const ALLOWED_EMAIL_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  "img",
  "span",
];
const ALLOWED_EMAIL_ATTRIBUTES = {
  ...sanitizeHtml.defaults.allowedAttributes,
  a: ["href", "name", "target", "rel"],
  img: ["src", "alt", "title"],
};

const { createTransport } = nodemailer;

function createEmailProviderError({
  message,
  code,
  status = null,
  retryable = false,
  attempts = 0,
  details,
}) {
  const error = new Error(message);
  error.provider = EMAIL_PROVIDER;
  error.code = code;
  error.status = status;
  error.retryable = retryable;
  error.attempts = attempts;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function normalizeEmailAddress(email) {
  if (!email || typeof email !== "string") {
    throw createEmailProviderError({
      message: "Recipient email is required",
      code: "BREVO_INVALID_RECIPIENT",
      status: 400,
      retryable: false,
    });
  }

  const trimmed = email.trim();
  if (!trimmed || !trimmed.includes("@")) {
    throw createEmailProviderError({
      message: "Recipient email is invalid",
      code: "BREVO_INVALID_RECIPIENT",
      status: 400,
      retryable: false,
    });
  }

  return trimmed;
}

function normalizeEmailSubject(subject) {
  if (!subject || typeof subject !== "string" || !subject.trim()) {
    throw createEmailProviderError({
      message: "Email subject is required",
      code: "BREVO_INVALID_SUBJECT",
      status: 400,
      retryable: false,
    });
  }

  return subject.trim();
}

function normalizeEmailHtml(text) {
  if (!text || typeof text !== "string" || !text.trim()) {
    throw createEmailProviderError({
      message: "Email content is required",
      code: "BREVO_INVALID_CONTENT",
      status: 400,
      retryable: false,
    });
  }

  const html = sanitizeHtml(text, {
    allowedTags: ALLOWED_EMAIL_TAGS,
    allowedAttributes: ALLOWED_EMAIL_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["http", "https"],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
      }),
    },
  });

  if (!html.trim()) {
    throw createEmailProviderError({
      message: "Email content is required",
      code: "BREVO_INVALID_CONTENT",
      status: 400,
      retryable: false,
    });
  }

  return html;
}

function resolveFromAddress(env = process.env) {
  const fromEmail = env.EMAIL_FROM_ADDRESS || DEFAULT_FROM_EMAIL;
  const fromName = env.EMAIL_FROM_NAME || DEFAULT_FROM_NAME;
  return `"${fromName}" ${fromEmail}`;
}

function parseProviderStatus(error) {
  const rawStatus =
    error?.status ||
    error?.statusCode ||
    error?.response?.status ||
    error?.response?.statusCode;
  const parsed = Number.parseInt(rawStatus, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildProviderErrorDetails(error) {
  return {
    name: error?.name || null,
    originalCode: error?.code || null,
    responseCode: error?.response?.code || null,
  };
}

async function resolveEmailProviderConfig(env = process.env) {
  let apiKeyDoc = null;
  let apiKey = null;
  let source = null;

  try {
    apiKeyDoc = await ApiKey.getActiveConfig();
    if (apiKeyDoc?.nodemailerApiKey) {
      apiKey = apiKeyDoc.nodemailerApiKey;
      source = "database";
    }
  } catch (error) {
    console.warn(
      "Failed to fetch Brevo API key from database:",
      error.message
    );
  }

  if (!apiKey && env.NODEMAILER_API_KEY) {
    apiKey = env.NODEMAILER_API_KEY;
    source = "environment";
  }

  if (!apiKey) {
    throw createEmailProviderError({
      message:
        "Brevo email provider is not configured: NODEMAILER_API_KEY is missing",
      code: "BREVO_CONFIG_MISSING",
      status: 503,
      retryable: false,
      details: { missing: ["NODEMAILER_API_KEY"] },
    });
  }

  return {
    apiKey,
    apiKeyDoc,
    source,
    from: resolveFromAddress(env),
  };
}

function normalizeProviderError(error, attempts = 1) {
  if (error?.provider === EMAIL_PROVIDER) {
    return error;
  }

  const status = parseProviderStatus(error);
  const retryable = status ? RETRYABLE_BREVO_STATUSES.has(status) : false;

  return createEmailProviderError({
    message: error?.message || "Brevo email request failed",
    code: error?.code || (status ? `BREVO_HTTP_${status}` : "BREVO_ERROR"),
    status,
    retryable,
    attempts,
    details: buildProviderErrorDetails(error),
  });
}

async function sendMail(email, subject, text) {
  const to = normalizeEmailAddress(email);
  const normalizedSubject = normalizeEmailSubject(subject);
  const html = normalizeEmailHtml(text);
  const config = await resolveEmailProviderConfig();
  const attempts = 1;

  try {
    const transport = createTransport(new Transport({ apiKey: config.apiKey }));
    const data = await transport.sendMail({
      from: config.from,
      to,
      subject: normalizedSubject,
      html,
    });

    if (config.source === "database" && config.apiKeyDoc?.updateUsage) {
      try {
        await config.apiKeyDoc.updateUsage();
      } catch (usageError) {
        console.warn("Failed to update Brevo API key usage:", usageError.message);
      }
    }

    return {
      ...data,
      provider: EMAIL_PROVIDER,
      messageId: data?.messageId || data?.response || null,
      attempts,
    };
  } catch (error) {
    throw normalizeProviderError(error, attempts);
  }
}

module.exports = sendMail;
module.exports.EMAIL_PROVIDER = EMAIL_PROVIDER;
module.exports.createEmailProviderError = createEmailProviderError;
module.exports.normalizeProviderError = normalizeProviderError;
module.exports.resolveEmailProviderConfig = resolveEmailProviderConfig;
