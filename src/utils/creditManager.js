const Business = require("../models/User/business");
const ErrorHandler = require("./ErrorHandler");

/**
 * Credit Management Utility
 * Handles SMS and Email credit validation and deduction
 */

/**
 * Check if business has sufficient SMS credits
 * @param {string} businessId - Business ID
 * @param {number} requiredCredits - Number of SMS credits required
 * @returns {Promise<{hasCredits: boolean, currentCredits: number}>}
 */
const checkSmsCredits = async (businessId, requiredCredits = 1) => {
  try {
    const business = await Business.findById(businessId);
    if (!business) {
      throw new Error("Business not found");
    }

    const currentCredits = business.smsCredits || 0;
    const hasCredits = currentCredits >= requiredCredits;

    return {
      hasCredits,
      currentCredits,
      requiredCredits,
    };
  } catch (error) {
    console.error("Error checking SMS credits:", error);
    throw error;
  }
};

/**
 * Check if business has sufficient Email credits
 * @param {string} businessId - Business ID
 * @param {number} requiredCredits - Number of Email credits required
 * @returns {Promise<{hasCredits: boolean, currentCredits: number}>}
 */
const checkEmailCredits = async (businessId, requiredCredits = 1) => {
  try {
    const business = await Business.findById(businessId);
    if (!business) {
      throw new Error("Business not found");
    }

    const currentCredits = business.emailCredits || 0;
    const hasCredits = currentCredits >= requiredCredits;

    return {
      hasCredits,
      currentCredits,
      requiredCredits,
    };
  } catch (error) {
    console.error("Error checking Email credits:", error);
    throw error;
  }
};

/**
 * Deduct SMS credits from business
 * @param {string} businessId - Business ID
 * @param {number} creditsToDeduct - Number of SMS credits to deduct
 * @returns {Promise<{success: boolean, remainingCredits: number}>}
 */
const deductSmsCredits = async (businessId, creditsToDeduct = 1) => {
  try {
    const business = await Business.findById(businessId);
    if (!business) {
      throw new Error("Business not found");
    }

    const currentCredits = business.smsCredits || 0;

    if (currentCredits < creditsToDeduct) {
      throw new Error(
        `Insufficient SMS credits. Required: ${creditsToDeduct}, Available: ${currentCredits}`
      );
    }

    business.smsCredits = Math.max(0, currentCredits - creditsToDeduct);
    await business.save();

    console.log(
      `Deducted ${creditsToDeduct} SMS credits from business ${businessId}. Remaining: ${business.smsCredits}`
    );

    return {
      success: true,
      remainingCredits: business.smsCredits,
      deductedCredits: creditsToDeduct,
    };
  } catch (error) {
    console.error("Error deducting SMS credits:", error);
    throw error;
  }
};

/**
 * Deduct Email credits from business
 * @param {string} businessId - Business ID
 * @param {number} creditsToDeduct - Number of Email credits to deduct
 * @returns {Promise<{success: boolean, remainingCredits: number}>}
 */
const deductEmailCredits = async (businessId, creditsToDeduct = 1) => {
  try {
    const business = await Business.findById(businessId);
    if (!business) {
      throw new Error("Business not found");
    }

    const currentCredits = business.emailCredits || 0;

    if (currentCredits < creditsToDeduct) {
      throw new Error(
        `Insufficient Email credits. Required: ${creditsToDeduct}, Available: ${currentCredits}`
      );
    }

    business.emailCredits = Math.max(0, currentCredits - creditsToDeduct);
    await business.save();

    console.log(
      `Deducted ${creditsToDeduct} Email credits from business ${businessId}. Remaining: ${business.emailCredits}`
    );

    return {
      success: true,
      remainingCredits: business.emailCredits,
      deductedCredits: creditsToDeduct,
    };
  } catch (error) {
    console.error("Error deducting Email credits:", error);
    throw error;
  }
};

/**
 * Add SMS credits to business (for purchases)
 * @param {string} businessId - Business ID
 * @param {number} creditsToAdd - Number of SMS credits to add
 * @returns {Promise<{success: boolean, totalCredits: number}>}
 */
const addSmsCredits = async (businessId, creditsToAdd) => {
  try {
    const business = await Business.findById(businessId);
    if (!business) {
      throw new Error("Business not found");
    }

    business.smsCredits = (business.smsCredits || 0) + creditsToAdd;
    await business.save();

    console.log(
      `Added ${creditsToAdd} SMS credits to business ${businessId}. Total: ${business.smsCredits}`
    );

    return {
      success: true,
      totalCredits: business.smsCredits,
      addedCredits: creditsToAdd,
    };
  } catch (error) {
    console.error("Error adding SMS credits:", error);
    throw error;
  }
};

/**
 * Add Email credits to business (for purchases)
 * @param {string} businessId - Business ID
 * @param {number} creditsToAdd - Number of Email credits to add
 * @returns {Promise<{success: boolean, totalCredits: number}>}
 */
const addEmailCredits = async (businessId, creditsToAdd) => {
  try {
    const business = await Business.findById(businessId);
    if (!business) {
      throw new Error("Business not found");
    }

    business.emailCredits = (business.emailCredits || 0) + creditsToAdd;
    await business.save();

    console.log(
      `Added ${creditsToAdd} Email credits to business ${businessId}. Total: ${business.emailCredits}`
    );

    return {
      success: true,
      totalCredits: business.emailCredits,
      addedCredits: creditsToAdd,
    };
  } catch (error) {
    console.error("Error adding Email credits:", error);
    throw error;
  }
};

/**
 * Get business credit summary
 * @param {string} businessId - Business ID
 * @returns {Promise<{smsCredits: number, emailCredits: number}>}
 */
const getBusinessCredits = async (businessId) => {
  try {
    const business = await Business.findById(businessId);
    if (!business) {
      throw new Error("Business not found");
    }

    return {
      smsCredits: business.smsCredits || 0,
      emailCredits: business.emailCredits || 0,
    };
  } catch (error) {
    console.error("Error getting business credits:", error);
    throw error;
  }
};

/**
 * Validate and deduct SMS credits with error handling
 * @param {string} businessId - Business ID
 * @param {number} requiredCredits - Number of SMS credits required
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<boolean>} - Returns true if credits are available and deducted
 */
const validateAndDeductSmsCredits = async (
  businessId,
  requiredCredits,
  req,
  res
) => {
  try {
    const creditCheck = await checkSmsCredits(businessId, requiredCredits);

    if (!creditCheck.hasCredits) {
      // Log the error but don't send response - let calling function handle it
      console.error(
        `Insufficient SMS credits for business ${businessId}. Required: ${requiredCredits}, Available: ${creditCheck.currentCredits}`
      );
      return false;
    }

    await deductSmsCredits(businessId, requiredCredits);
    return true;
  } catch (error) {
    console.error("Error validating SMS credits:", error);
    return false;
  }
};

/**
 * Validate and deduct Email credits with error handling
 * @param {string} businessId - Business ID
 * @param {number} requiredCredits - Number of Email credits required
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<boolean>} - Returns true if credits are available and deducted
 */
const validateAndDeductEmailCredits = async (
  businessId,
  requiredCredits,
  req,
  res
) => {
  try {
    const creditCheck = await checkEmailCredits(businessId, requiredCredits);

    if (!creditCheck.hasCredits) {
      // Log the error but don't send response - let calling function handle it
      console.error(
        `Insufficient Email credits for business ${businessId}. Required: ${requiredCredits}, Available: ${creditCheck.currentCredits}`
      );
      return false;
    }

    await deductEmailCredits(businessId, requiredCredits);
    return true;
  } catch (error) {
    console.error("Error validating Email credits:", error);
    return false;
  }
};

module.exports = {
  checkSmsCredits,
  checkEmailCredits,
  deductSmsCredits,
  deductEmailCredits,
  addSmsCredits,
  addEmailCredits,
  getBusinessCredits,
  validateAndDeductSmsCredits,
  validateAndDeductEmailCredits,
};
