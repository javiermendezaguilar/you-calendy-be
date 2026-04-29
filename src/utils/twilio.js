const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_API_BASE_URL = "https://api.twilio.com/2010-04-01";

function buildTwilioAuthHeader() {
  const token = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString(
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

/**
 * Send an SMS using Twilio
 * @param {string} to - Recipient phone number (in E.164 format)
 * @param {string} body - Message content
 * @returns {Promise<object>} - Twilio message response
 */
async function sendSMS(to, body) {
  console.log(`Twilio SMS: Attempting to send SMS to ${to}`);
  console.log(`Twilio SMS: From number: ${TWILIO_FROM_NUMBER}`);

  if (!to || !body) {
    throw new Error("Recipient phone number and message body are required");
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials are not configured");
  }

  if (!TWILIO_FROM_NUMBER) {
    throw new Error("Twilio from number is not configured");
  }

  try {
    const formattedTo = to.startsWith("+") ? to : `+${to}`;
    const response = await fetch(
      `${TWILIO_API_BASE_URL}/Accounts/${encodeURIComponent(
        TWILIO_ACCOUNT_SID
      )}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: buildTwilioAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          Body: body,
          From: TWILIO_FROM_NUMBER,
          To: formattedTo,
        }),
      }
    );
    const result = await readTwilioResponse(response);

    if (!response.ok) {
      const error = new Error(
        result.message || `Twilio request failed with status ${response.status}`
      );
      error.code = result.code;
      error.status = response.status;
      throw error;
    }

    console.log(
      `Twilio SMS: Successfully sent SMS to ${to}. Message ID: ${result.sid}`
    );
    return result;
  } catch (error) {
    console.error(
      `Twilio SMS: Failed to send SMS to ${to}. Error:`,
      error.message
    );
    throw error;
  }
}

module.exports = {
  sendSMS,
};
