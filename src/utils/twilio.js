const DEFAULT_TWILIO_API_BASE_URL = "https://api.twilio.com/2010-04-01";
const RETRYABLE_TWILIO_STATUSES = new Set([429, 500, 502, 503, 504]);

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveTwilioConfig(env = process.env) {
  return {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    fromNumber: env.TWILIO_FROM_NUMBER,
    apiBaseUrl: env.TWILIO_API_BASE_URL || DEFAULT_TWILIO_API_BASE_URL,
    maxRetries: parseNonNegativeInteger(env.TWILIO_MAX_RETRIES, 1),
  };
}

function createTwilioError({
  message,
  code,
  status = null,
  retryable = false,
  attempts = 0,
  details,
}) {
  const error = new Error(message);
  error.provider = "twilio";
  error.code = code;
  error.status = status;
  error.retryable = retryable;
  error.attempts = attempts;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function assertTwilioConfig(config) {
  const missing = [];

  if (!config.accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!config.authToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!config.fromNumber) missing.push("TWILIO_FROM_NUMBER");

  if (missing.length > 0) {
    throw createTwilioError({
      message: `Twilio configuration is incomplete: ${missing.join(", ")}`,
      code: "TWILIO_CONFIG_MISSING",
      status: 503,
      retryable: false,
      details: { missing },
    });
  }
}

function normalizeRecipient(to) {
  if (!to || typeof to !== "string") {
    throw createTwilioError({
      message: "Recipient phone number is required",
      code: "TWILIO_INVALID_RECIPIENT",
      status: 400,
      retryable: false,
    });
  }

  const trimmed = to.trim();
  if (!trimmed) {
    throw createTwilioError({
      message: "Recipient phone number is required",
      code: "TWILIO_INVALID_RECIPIENT",
      status: 400,
      retryable: false,
    });
  }

  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

function normalizeMessageBody(body) {
  if (!body || typeof body !== "string" || !body.trim()) {
    throw createTwilioError({
      message: "Message body is required",
      code: "TWILIO_INVALID_MESSAGE",
      status: 400,
      retryable: false,
    });
  }

  return body.trim();
}

function buildTwilioAuthHeader(config) {
  const token = Buffer.from(`${config.accountSid}:${config.authToken}`).toString(
    "base64"
  );
  return `Basic ${token}`;
}

async function readTwilioResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

function isRetryableTwilioStatus(status) {
  return RETRYABLE_TWILIO_STATUSES.has(status);
}

function buildTwilioMessageUrl(config) {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, "");
  return `${baseUrl}/Accounts/${encodeURIComponent(
    config.accountSid
  )}/Messages.json`;
}

async function postTwilioMessage(config, to, body) {
  return fetch(buildTwilioMessageUrl(config), {
    method: "POST",
    headers: {
      Authorization: buildTwilioAuthHeader(config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      Body: body,
      From: config.fromNumber,
      To: to,
    }),
  });
}

/**
 * Send an SMS using Twilio
 * @param {string} to - Recipient phone number (in E.164 format)
 * @param {string} body - Message content
 * @returns {Promise<object>} - Twilio message response
 */
async function sendSMS(to, body) {
  const config = resolveTwilioConfig();
  assertTwilioConfig(config);

  const formattedTo = normalizeRecipient(to);
  const messageBody = normalizeMessageBody(body);
  let attempt = 0;

  while (attempt <= config.maxRetries) {
    attempt += 1;
    let response;

    try {
      response = await postTwilioMessage(config, formattedTo, messageBody);
    } catch (error) {
      throw createTwilioError({
        message: error.message || "Twilio network request failed",
        code: "TWILIO_NETWORK_ERROR",
        retryable: false,
        attempts: attempt,
      });
    }

    const result = await readTwilioResponse(response);

    if (response.ok) {
      return {
        ...result,
        provider: "twilio",
        messageId: result.sid || result.messageId || null,
        attempts: attempt,
      };
    }

    const retryable = isRetryableTwilioStatus(response.status);
    if (retryable && attempt <= config.maxRetries) {
      continue;
    }

    throw createTwilioError({
      message:
        result.message || `Twilio request failed with status ${response.status}`,
      code: result.code || `TWILIO_HTTP_${response.status}`,
      status: response.status,
      retryable,
      attempts: attempt,
      details: result,
    });
  }
}

module.exports = {
  createTwilioError,
  isRetryableTwilioStatus,
  resolveTwilioConfig,
  sendSMS,
};
