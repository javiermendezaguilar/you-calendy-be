const twilio = require("twilio");

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

/**
 * Send an SMS using Twilio
 * @param {string} to - Recipient phone number (in E.164 format)
 * @param {string} body - Message content
 * @returns {Promise<object>} - Twilio message response
 */
async function sendSMS(to, body) {
  console.log(`Twilio SMS: Attempting to send SMS to ${to}`);
  console.log(`Twilio SMS: From number: ${TWILIO_FROM_NUMBER}`);
  console.log(`Twilio SMS: Message body: ${body}`);

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
    const formattedTo = to.startsWith('+') ? to : `+${to}`;
    const result = await twilioClient.messages.create({
      body,
      from: TWILIO_FROM_NUMBER,
      to: formattedTo,
    });

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
