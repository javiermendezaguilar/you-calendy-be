const Business = require("../models/User/business");
const ErrorHandler = require("../utils/ErrorHandler");

/**
 * Credit Middleware
 * Middleware functions to validate credits before operations
 */

/**
 * Middleware to check SMS credits before campaign operations
 * @param {number} requiredCredits - Number of SMS credits required (default: 1)
 * @returns {Function} Express middleware function
 */
const checkSmsCredits = (requiredCredits = 1) => {
  return async (req, res, next) => {
    try {
      const business = await Business.findOne({ owner: req.user.id });
      if (!business) {
        return ErrorHandler("Business not found", 404, req, res);
      }

      const currentCredits = business.smsCredits || 0;

      if (currentCredits < requiredCredits) {
        return ErrorHandler(
          `Insufficient SMS credits. Required: ${requiredCredits}, Available: ${currentCredits}. Please purchase more credits to continue.`,
          402, // Payment Required
          req,
          res
        );
      }

      // Add credit info to request for use in controller
      req.businessCredits = {
        smsCredits: currentCredits,
        emailCredits: business.emailCredits || 0,
        businessId: business._id,
      };

      next();
    } catch (error) {
      console.error("Error checking SMS credits:", error);
      return ErrorHandler(error.message, 500, req, res);
    }
  };
};

/**
 * Middleware to check Email credits before campaign operations
 * @param {number} requiredCredits - Number of Email credits required (default: 1)
 * @returns {Function} Express middleware function
 */
const checkEmailCredits = (requiredCredits = 1) => {
  return async (req, res, next) => {
    try {
      const business = await Business.findOne({ owner: req.user.id });
      if (!business) {
        return ErrorHandler("Business not found", 404, req, res);
      }

      const currentCredits = business.emailCredits || 0;

      if (currentCredits < requiredCredits) {
        return ErrorHandler(
          `Insufficient Email credits. Required: ${requiredCredits}, Available: ${currentCredits}. Please purchase more credits to continue.`,
          402, // Payment Required
          req,
          res
        );
      }

      // Add credit info to request for use in controller
      req.businessCredits = {
        smsCredits: business.smsCredits || 0,
        emailCredits: currentCredits,
        businessId: business._id,
      };

      next();
    } catch (error) {
      console.error("Error checking Email credits:", error);
      return ErrorHandler(error.message, 500, req, res);
    }
  };
};

/**
 * Middleware to check both SMS and Email credits
 * @param {number} smsCredits - Number of SMS credits required (default: 0)
 * @param {number} emailCredits - Number of Email credits required (default: 0)
 * @returns {Function} Express middleware function
 */
const checkBothCredits = (smsCredits = 0, emailCredits = 0) => {
  return async (req, res, next) => {
    try {
      const business = await Business.findOne({ owner: req.user.id });
      if (!business) {
        return ErrorHandler("Business not found", 404, req, res);
      }

      const currentSmsCredits = business.smsCredits || 0;
      const currentEmailCredits = business.emailCredits || 0;

      const smsInsufficient = smsCredits > 0 && currentSmsCredits < smsCredits;
      const emailInsufficient =
        emailCredits > 0 && currentEmailCredits < emailCredits;

      if (smsInsufficient || emailInsufficient) {
        let errorMessage = "Insufficient credits: ";
        const errors = [];

        if (smsInsufficient) {
          errors.push(
            `SMS credits (Required: ${smsCredits}, Available: ${currentSmsCredits})`
          );
        }
        if (emailInsufficient) {
          errors.push(
            `Email credits (Required: ${emailCredits}, Available: ${currentEmailCredits})`
          );
        }

        errorMessage +=
          errors.join(", ") + ". Please purchase more credits to continue.";

        return ErrorHandler(errorMessage, 402, req, res);
      }

      // Add credit info to request for use in controller
      req.businessCredits = {
        smsCredits: currentSmsCredits,
        emailCredits: currentEmailCredits,
        businessId: business._id,
      };

      next();
    } catch (error) {
      console.error("Error checking credits:", error);
      return ErrorHandler(error.message, 500, req, res);
    }
  };
};

/**
 * Middleware to check credits based on recipient count
 * This is useful for bulk operations where the credit requirement depends on the number of recipients
 * @param {string} recipientField - Field name in request body that contains recipient count
 * @param {string} creditType - 'sms' or 'email'
 * @returns {Function} Express middleware function
 */
const checkCreditsByRecipientCount = (recipientField, creditType = "sms") => {
  return async (req, res, next) => {
    try {
      const business = await Business.findOne({ owner: req.user.id });
      if (!business) {
        return ErrorHandler("Business not found", 404, req, res);
      }

      const recipientCount = req.body[recipientField];
      if (!recipientCount || recipientCount <= 0) {
        return ErrorHandler(`Invalid ${recipientField} count`, 400, req, res);
      }

      const currentCredits =
        creditType === "sms"
          ? business.smsCredits || 0
          : business.emailCredits || 0;

      if (currentCredits < recipientCount) {
        const creditTypeName = creditType === "sms" ? "SMS" : "Email";
        return ErrorHandler(
          `Insufficient ${creditTypeName} credits. Required: ${recipientCount}, Available: ${currentCredits}. Please purchase more credits to continue.`,
          402,
          req,
          res
        );
      }

      // Add credit info to request for use in controller
      req.businessCredits = {
        smsCredits: business.smsCredits || 0,
        emailCredits: business.emailCredits || 0,
        businessId: business._id,
        requiredCredits: recipientCount,
        creditType,
      };

      next();
    } catch (error) {
      console.error("Error checking credits by recipient count:", error);
      return ErrorHandler(error.message, 500, req, res);
    }
  };
};

/**
 * Middleware to get business credit information without validation
 * Useful for endpoints that need to display credit information
 * @returns {Function} Express middleware function
 */
const getBusinessCredits = () => {
  return async (req, res, next) => {
    try {
      const business = await Business.findOne({ owner: req.user.id });
      if (!business) {
        return ErrorHandler("Business not found", 404, req, res);
      }

      // Add credit info to request for use in controller
      req.businessCredits = {
        smsCredits: business.smsCredits || 0,
        emailCredits: business.emailCredits || 0,
        businessId: business._id,
      };

      next();
    } catch (error) {
      console.error("Error getting business credits:", error);
      return ErrorHandler(error.message, 500, req, res);
    }
  };
};

module.exports = {
  checkSmsCredits,
  checkEmailCredits,
  checkBothCredits,
  checkCreditsByRecipientCount,
  getBusinessCredits,
};
