const { sendSMS } = require("./twilio");
const sendMail = require("./sendMail");
const {
  checkSmsCredits,
  checkEmailCredits,
  deductSmsCredits,
  deductEmailCredits,
  addSmsCredits,
  addEmailCredits,
} = require("./creditManager");

/**
 * Credit-Aware Messaging Utilities
 * Wrapper functions that handle credit validation and deduction around sending messages
 */

const buildCreditReservationError = (error, creditsRequired, creditType) => ({
  error: true,
  message: error.message || `Insufficient ${creditType} credits`,
  creditsRequired,
});

const refundCredits = async (businessId, creditsToRefund, creditType) => {
  if (creditsToRefund <= 0) {
    return null;
  }

  if (creditType === "sms") {
    return addSmsCredits(businessId, creditsToRefund);
  }

  return addEmailCredits(businessId, creditsToRefund);
};

const createEmptyBulkCreditResult = (totalRecipients) => ({
  totalRecipients,
  successCount: 0,
  failedCount: 0,
  failedRecipients: [],
  creditsUsed: 0,
  creditsRefunded: 0,
});

const reserveBulkCredits = async (businessId, totalRecipients, creditType) => {
  if (creditType === "sms") {
    return deductSmsCredits(businessId, totalRecipients);
  }

  return deductEmailCredits(businessId, totalRecipients);
};

const sendBulkWithReservedCredits = async ({
  recipients,
  businessId,
  creditType,
  creditTypeName,
  recipientKey,
  sendRecipient,
}) => {
  const totalRecipients = recipients.length;

  if (totalRecipients <= 0) {
    return createEmptyBulkCreditResult(totalRecipients);
  }

  try {
    await reserveBulkCredits(businessId, totalRecipients, creditType);
  } catch (creditError) {
    return buildCreditReservationError(
      creditError,
      totalRecipients,
      creditTypeName
    );
  }

  const results = createEmptyBulkCreditResult(totalRecipients);

  for (const recipient of recipients) {
    try {
      await sendRecipient(recipient);
      results.successCount++;
    } catch (sendError) {
      results.failedCount++;
      results.failedRecipients.push({
        [recipientKey]: recipient[recipientKey],
        error: sendError.message,
        provider: sendError.provider || null,
        code: sendError.code || null,
        status: sendError.status || null,
        attempts: sendError.attempts || null,
      });
      console.error(
        `Failed to send ${creditTypeName} to ${recipient[recipientKey]}:`,
        sendError.message
      );
    }
  }

  results.creditsUsed = results.successCount;
  results.creditsRefunded = results.failedCount;
  if (results.creditsRefunded > 0) {
    await refundCredits(businessId, results.creditsRefunded, creditType);
  }

  return results;
};

/**
 * Send SMS with credit reservation and provider-failure refund.
 * @param {string} to - Recipient phone number
 * @param {string} body - Message content
 * @param {string} businessId - Business ID for credit deduction
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} - SMS sending result
 */
const sendSMSWithCredits = async (to, body, businessId, req, res) => {
  const creditsReserved = 1;
  let didReserveCredits = false;

  try {
    console.log(`Starting SMS credit validation for business ${businessId}`);

    await deductSmsCredits(businessId, creditsReserved);
    didReserveCredits = true;

    console.log(
      `Credits validated successfully for business ${businessId}. Attempting to send SMS to ${to}`
    );

    // Send SMS
    const result = await sendSMS(to, body);

    console.log(
      `SMS sent successfully to ${to} using 1 credit from business ${businessId}. Message ID: ${result.sid}`
    );

    return {
      success: true,
      messageId: result.messageId || result.sid || null,
      provider: result.provider || "twilio",
      attempts: result.attempts || 1,
      creditsUsed: 1,
    };
  } catch (error) {
    console.error("Error sending SMS with credits:", error);
    if (didReserveCredits) {
      await refundCredits(businessId, creditsReserved, "sms");
    }
    return {
      error: true,
      message: error.message || "Failed to send SMS",
      details: error,
    };
  }
};

/**
 * Send Email with credit validation and deduction
 * @param {string} email - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} content - Email content
 * @param {string} businessId - Business ID for credit deduction
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} - Email sending result
 */
const sendEmailWithCredits = async (
  email,
  subject,
  content,
  businessId,
  req,
  res
) => {
  const creditsReserved = 1;
  let didReserveCredits = false;

  try {
    await deductEmailCredits(businessId, creditsReserved);
    didReserveCredits = true;

    // Send Email
    await sendMail(email, subject, content);

    console.log(
      `Email sent successfully to ${email} using 1 credit from business ${businessId}`
    );

    return {
      success: true,
      creditsUsed: 1,
    };
  } catch (error) {
    console.error("Error sending Email with credits:", error);
    if (didReserveCredits) {
      await refundCredits(businessId, creditsReserved, "email");
    }
    return {
      error: true,
      message: error.message || "Failed to send Email",
      details: error,
    };
  }
};

/**
 * Send multiple SMS with upfront credit reservation and failed-send refund.
 * @param {Array} recipients - Array of recipient objects with 'phone' property
 * @param {string} body - Message content
 * @param {string} businessId - Business ID for credit deduction
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} - SMS sending results
 */
const sendBulkSMSWithCredits = async (
  recipients,
  body,
  businessId,
  req,
  res
) => {
  try {
    const results = await sendBulkWithReservedCredits({
      recipients,
      businessId,
      creditType: "sms",
      creditTypeName: "SMS",
      recipientKey: "phone",
      sendRecipient: (recipient) => sendSMS(recipient.phone, body),
    });

    console.log(
      `Bulk SMS completed: ${results.successCount}/${results.totalRecipients} sent successfully using ${results.creditsUsed} credits from business ${businessId}`
    );

    return results;
  } catch (error) {
    console.error("Error sending bulk SMS with credits:", error);
    throw error;
  }
};

/**
 * Send multiple Emails with credit validation and deduction
 * @param {Array} recipients - Array of recipient objects with 'email' property
 * @param {string} subject - Email subject
 * @param {string} content - Email content
 * @param {string} businessId - Business ID for credit deduction
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} - Email sending results
 */
const sendBulkEmailWithCredits = async (
  recipients,
  subject,
  content,
  businessId,
  req,
  res
) => {
  try {
    const results = await sendBulkWithReservedCredits({
      recipients,
      businessId,
      creditType: "email",
      creditTypeName: "Email",
      recipientKey: "email",
      sendRecipient: (recipient) => sendMail(recipient.email, subject, content),
    });

    console.log(
      `Bulk Email completed: ${results.successCount}/${results.totalRecipients} sent successfully using ${results.creditsUsed} credits from business ${businessId}`
    );

    return results;
  } catch (error) {
    console.error("Error sending bulk Email with credits:", error);
    throw error;
  }
};

/**
 * Check if business has sufficient credits for bulk operations
 * @param {string} businessId - Business ID
 * @param {number} smsCount - Number of SMS to send
 * @param {number} emailCount - Number of Emails to send
 * @returns {Promise<Object>} - Credit availability status
 */
const checkBulkCredits = async (businessId, smsCount = 0, emailCount = 0) => {
  try {
    const smsCheck =
      smsCount > 0
        ? await checkSmsCredits(businessId, smsCount)
        : { hasCredits: true, currentCredits: 0 };
    const emailCheck =
      emailCount > 0
        ? await checkEmailCredits(businessId, emailCount)
        : { hasCredits: true, currentCredits: 0 };

    return {
      sms: {
        hasCredits: smsCheck.hasCredits,
        currentCredits: smsCheck.currentCredits,
        requiredCredits: smsCount,
      },
      email: {
        hasCredits: emailCheck.hasCredits,
        currentCredits: emailCheck.currentCredits,
        requiredCredits: emailCount,
      },
      allSufficient: smsCheck.hasCredits && emailCheck.hasCredits,
    };
  } catch (error) {
    console.error("Error checking bulk credits:", error);
    throw error;
  }
};

module.exports = {
  sendSMSWithCredits,
  sendEmailWithCredits,
  sendBulkSMSWithCredits,
  sendBulkEmailWithCredits,
  checkBulkCredits,
};
