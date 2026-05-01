const Business = require("../models/User/business");
const {
  recordBusinessSignal,
} = require("../services/businessObservabilityService");

/**
 * Credit Management Utility
 * Handles SMS and Email credit validation and deduction
 */

const creditFields = {
  sms: {
    field: "smsCredits",
    label: "SMS",
  },
  email: {
    field: "emailCredits",
    label: "Email",
  },
};

const normalizeCreditAmount = (value, { label, allowZero = false }) => {
  const amount = Number(value);
  const isValidInteger = Number.isInteger(amount);
  const minimum = allowZero ? 0 : 1;

  if (!isValidInteger || amount < minimum) {
    const kind = allowZero ? "non-negative integer" : "positive integer";
    throw new Error(`${label} credits amount must be a ${kind}`);
  }

  return amount;
};

const getBusinessCreditBalance = async (businessId, field) => {
  const business = await Business.findById(businessId).select(field).lean();
  if (!business) {
    throw new Error("Business not found");
  }

  return business[field] || 0;
};

const buildInsufficientCreditsError = (label, requiredCredits, currentCredits) =>
  new Error(
    `Insufficient ${label} credits. Required: ${requiredCredits}, Available: ${currentCredits}`
  );

const creditSignalTypesByAction = {
  added: "credit_added",
  deducted: "credit_deducted",
  deduct_rejected: "credit_deduction_rejected",
};

const logCreditOutcome = async (payload) => {
  const action = payload.action || "unknown";
  await recordBusinessSignal({
    signalType: creditSignalTypesByAction[action] || "credit_outcome",
    severity: action === "deduct_rejected" ? "warning" : "info",
    businessId: payload.businessId,
    source: "credit_manager",
    action,
    reason: payload.reason || action,
    entityType: "credit_balance",
    entityId: payload.creditType || "",
    metadata: payload,
  });
};

const checkCredits = async (businessId, requiredCredits, creditType) => {
  const { field, label } = creditFields[creditType];
  const normalizedRequiredCredits = normalizeCreditAmount(requiredCredits, {
    label,
  });
  const currentCredits = await getBusinessCreditBalance(businessId, field);

  return {
    hasCredits: currentCredits >= normalizedRequiredCredits,
    currentCredits,
    requiredCredits: normalizedRequiredCredits,
  };
};

const deductCredits = async (businessId, creditsToDeduct, creditType) => {
  const { field, label } = creditFields[creditType];
  const normalizedCreditsToDeduct = normalizeCreditAmount(creditsToDeduct, {
    label,
  });

  const business = await Business.findOneAndUpdate(
    {
      _id: businessId,
      [field]: { $gte: normalizedCreditsToDeduct },
    },
    {
      $inc: {
        [field]: -normalizedCreditsToDeduct,
      },
    },
    { new: true }
  ).select(field);

  if (!business) {
    const currentCredits = await getBusinessCreditBalance(businessId, field);
    await logCreditOutcome({
      businessId: String(businessId),
      creditType,
      action: "deduct_rejected",
      credits: normalizedCreditsToDeduct,
      currentCredits,
      reason: "insufficient_credits",
    });
    throw buildInsufficientCreditsError(
      label,
      normalizedCreditsToDeduct,
      currentCredits
    );
  }

  await logCreditOutcome({
    businessId: String(businessId),
    creditType,
    action: "deducted",
    credits: normalizedCreditsToDeduct,
    remainingCredits: business[field] || 0,
  });

  return {
    success: true,
    remainingCredits: business[field] || 0,
    deductedCredits: normalizedCreditsToDeduct,
  };
};

const addCredits = async (businessId, creditsToAdd, creditType) => {
  const { field, label } = creditFields[creditType];
  const normalizedCreditsToAdd = normalizeCreditAmount(creditsToAdd, {
    label,
    allowZero: true,
  });

  if (normalizedCreditsToAdd === 0) {
    const currentCredits = await getBusinessCreditBalance(businessId, field);
    return {
      success: true,
      totalCredits: currentCredits,
      addedCredits: 0,
    };
  }

  const business = await Business.findByIdAndUpdate(
    businessId,
    {
      $inc: {
        [field]: normalizedCreditsToAdd,
      },
    },
    { new: true }
  ).select(field);

  if (!business) {
    throw new Error("Business not found");
  }

  await logCreditOutcome({
    businessId: String(businessId),
    creditType,
    action: "added",
    credits: normalizedCreditsToAdd,
    totalCredits: business[field] || 0,
  });

  return {
    success: true,
    totalCredits: business[field] || 0,
    addedCredits: normalizedCreditsToAdd,
  };
};

/**
 * Check if business has sufficient SMS credits
 * @param {string} businessId - Business ID
 * @param {number} requiredCredits - Number of SMS credits required
 * @returns {Promise<{hasCredits: boolean, currentCredits: number}>}
 */
const checkSmsCredits = async (businessId, requiredCredits = 1) => {
  try {
    return checkCredits(businessId, requiredCredits, "sms");
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
    return checkCredits(businessId, requiredCredits, "email");
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
    return deductCredits(businessId, creditsToDeduct, "sms");
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
    return deductCredits(businessId, creditsToDeduct, "email");
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
    return addCredits(businessId, creditsToAdd, "sms");
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
    return addCredits(businessId, creditsToAdd, "email");
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
