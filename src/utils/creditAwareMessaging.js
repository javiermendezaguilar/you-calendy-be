const { sendSMS } = require("./twilio");
const sendMail = require("./sendMail");
const {
  validateAndDeductSmsCredits,
  validateAndDeductEmailCredits,
} = require("./creditManager");

/**
 * Credit-Aware Messaging Utilities
 * Wrapper functions that handle credit validation and deduction before sending messages
 */

/**
 * Send SMS with credit validation and deduction
 * @param {string} to - Recipient phone number
 * @param {string} body - Message content
 * @param {string} businessId - Business ID for credit deduction
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} - SMS sending result
 */
const sendSMSWithCredits = async (to, body, businessId, req, res) => {
  try {
    console.log(`Starting SMS credit validation for business ${businessId}`);

    // Validate and deduct SMS credits
    const creditValid = await validateAndDeductSmsCredits(
      businessId,
      1,
      req,
      res
    );

    if (creditValid !== true) {
      console.log(`Credit validation failed for business ${businessId}`);
      return {
        error: true,
        message: "Insufficient SMS credits",
        creditsRequired: 1,
      };
    }

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
      messageId: result.sid,
      creditsUsed: 1,
    };
  } catch (error) {
    console.error("Error sending SMS with credits:", error);
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
  try {
    // Validate and deduct Email credits
    const creditValid = await validateAndDeductEmailCredits(
      businessId,
      1,
      req,
      res
    );
    if (creditValid !== true) {
      return {
        error: true,
        message: "Insufficient Email credits",
        creditsRequired: 1,
      };
    }

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
    throw error;
  }
};

/**
 * Send multiple SMS with credit validation and deduction
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
    const totalRecipients = recipients.length;

    // Validate and deduct SMS credits for all recipients
    const creditValid = await validateAndDeductSmsCredits(
      businessId,
      totalRecipients,
      req,
      res
    );
    if (creditValid !== true) {
      return {
        error: true,
        message: "Insufficient SMS credits",
        creditsRequired: totalRecipients,
      };
    }

    const results = {
      totalRecipients,
      successCount: 0,
      failedCount: 0,
      failedRecipients: [],
      creditsUsed: 0,
    };

    // Send SMS to each recipient
    for (const recipient of recipients) {
      try {
        await sendSMS(recipient.phone, body);
        results.successCount++;
        results.creditsUsed++;
      } catch (smsError) {
        results.failedCount++;
        results.failedRecipients.push({
          phone: recipient.phone,
          error: smsError.message,
        });
        console.error(
          `Failed to send SMS to ${recipient.phone}:`,
          smsError.message
        );
      }
    }

    console.log(
      `Bulk SMS completed: ${results.successCount}/${totalRecipients} sent successfully using ${results.creditsUsed} credits from business ${businessId}`
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
    const totalRecipients = recipients.length;

    // Validate and deduct Email credits for all recipients
    const creditValid = await validateAndDeductEmailCredits(
      businessId,
      totalRecipients,
      req,
      res
    );
    if (creditValid !== true) {
      return {
        error: true,
        message: "Insufficient Email credits",
        creditsRequired: totalRecipients,
      };
    }

    const results = {
      totalRecipients,
      successCount: 0,
      failedCount: 0,
      failedRecipients: [],
      creditsUsed: 0,
    };

    // Send Email to each recipient
    for (const recipient of recipients) {
      try {
        await sendMail(recipient.email, subject, content);
        results.successCount++;
        results.creditsUsed++;
      } catch (emailError) {
        results.failedCount++;
        results.failedRecipients.push({
          email: recipient.email,
          error: emailError.message,
        });
        console.error(
          `Failed to send Email to ${recipient.email}:`,
          emailError.message
        );
      }
    }

    console.log(
      `Bulk Email completed: ${results.successCount}/${totalRecipients} sent successfully using ${results.creditsUsed} credits from business ${businessId}`
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
    const { checkSmsCredits, checkEmailCredits } = require("./creditManager");

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
