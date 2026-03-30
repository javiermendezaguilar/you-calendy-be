const crypto = require("crypto");

/**
 * Generate a unique invitation token for client links
 * @returns {string} A unique 32-character hexadecimal token
 */
const generateInvitationToken = () => {
  return crypto.randomBytes(16).toString("hex");
};

/**
 * Generate a secure random token with custom length
 * @param {number} length - Length of the token (default: 32)
 * @returns {string} A unique token
 */
const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString("hex");
};

/**
 * Extract country code from an international phone number (E.164-ish).
 * @param {string} phone - The phone number to parse
 * @returns {string} The country code (digits only) or '92' (default)
 */
const getCountryCode = (phone) => {
  if (!phone) return '92';
  const cleaned = String(phone).replace(/\D/g, '');
  // Crude but effective for common cases: if it starts with 00, it's the next digits.
  // We'll rely on our common knowledge that many CCs are 1-2 digits.
  // But wait, it's better to just return the 1-2 digits if it's explicitly international.
  const phoneStr = String(phone).trim();
  if (phoneStr.startsWith('+') || phoneStr.startsWith('00')) {
     const digits = phoneStr.startsWith('+') ? phoneStr.substring(1).replace(/\D/g, '') : phoneStr.substring(2).replace(/\D/g, '');
     // Pakistan 92, US 1, UK 44, etc.
     if (digits.startsWith('92')) return '92';
     if (digits.startsWith('1')) return '1';
     if (digits.startsWith('44')) return '44';
     // General case: first 2 digits are usually enough for matching local prefixes
     return digits.substring(0, 2);
  }
  return '92';
};

function getUserDetail(user) {
  return {
    _id: user._id,
    profileImage: user.athleticDetails.profileImage || null,
    email: user.email,
    name: user.name,
  };
}

/**
 * Normalize phone number to a consistent canonical format (E.164 digits).
 * Handles international formats (+, 00) and can use a country code hint for local numbers.
 * @param {string} phone - The phone number to normalize
 * @param {string} countryHint - Optional country code to use for local numbers (e.g., '92', '1')
 * @returns {string} Normalized phone number (digits only, e.g., '923129876543')
 */
const normalizePhone = (phone, countryHint = '92') => {
  if (!phone) return phone;
  
  let phoneStr = String(phone).trim();
  
  // 1. Handle international prefix indicators
  let isInternational = false;
  if (phoneStr.startsWith('+')) {
    isInternational = true;
    phoneStr = phoneStr.substring(1);
  } else if (phoneStr.startsWith('00')) {
    isInternational = true;
    phoneStr = phoneStr.substring(2);
  }
  
  // 2. Clean all non-digit characters
  let cleaned = phoneStr.replace(/\D/g, '');
  
  // 3. If it was explicitly international, just return the cleaned digits
  if (isInternational) return cleaned;
  
  // 4. Handle local number patterns
  // Most countries use '0' as a trunk prefix for local dialing (e.g., 0312... in PK, 07... in UK)
  if (cleaned.startsWith('0')) {
    // Remove the leading zero and prepend country code hint
    return (countryHint || '92') + cleaned.substring(1);
  }
  
  // 5. If it's a standard length local number (e.g., 10 digits in US/PK) without prefix
  if (cleaned.length === 10 && countryHint) {
    return countryHint + cleaned;
  }

  // 6. If it already starts with the country hint (e.g., '92312...'), return as is
  if (countryHint && cleaned.startsWith(countryHint) && cleaned.length > 8) {
    return cleaned;
  }
  
  // Fallback: just return cleaned digits
  return cleaned;
};

/**
 * Get a consistent comparable representation of a phone number.
 * This format is used ONLY for comparison and matching, not for sending SMS.
 * It usually represents the subscriber portion of the number.
 * @param {string} phone - The phone number to process
 * @returns {string} The last 10 digits of the cleaned number
 */
const getComparablePhone = (phone) => {
  if (!phone) return phone;
  const cleaned = String(phone).replace(/\D/g, '');
  // Using the last 10 digits is a highly reliable way to match subscriber portions
  // across local (0312...) and international (+92312...) formats.
  return cleaned.length > 10 ? cleaned.slice(-10) : cleaned;
};

module.exports = {
  getUserDetail,
  generateInvitationToken,
  generateSecureToken,
  normalizePhone,
  getComparablePhone,
  getCountryCode,
};
