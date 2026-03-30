const Client = require('../models/client');
const Business = require('../models/User/business');
const ErrorHandler = require('../utils/ErrorHandler');
const moment = require('moment');
const { getComparablePhone } = require("../utils/index");

/**
 * Middleware to check if a client is blocked from booking due to unexcused no-shows.
 * This is a hard enforcement of the booking block at the backend level.
 */
const checkNoShowBlock = async (req, res, next) => {
  // Determine if caller is staff or owner (who are allowed to bypass the automated block)
  const isBusinessUser = req.user && (req.user.role === "barber" || req.user.role === "admin" || req.user.role === "sub-admin");
  
  // Clients and guests should be checked for blocks.
  // We identify the client to check either from the authenticated token or from req.body.clientId
  if (!isBusinessUser) {
    try {
      // Resolve client ID to check
      const clientId = (req.user && (req.user.type === "client" || req.user.role === "client")) 
        ? (req.user._id || req.user.id) 
        : (req.body.clientId || req.query.clientId);

      if (!clientId) {
        // If no client ID can be determined, we can't check for blocks.
        // This might be a guest creation flow that hasn't created the client record yet.
        return next();
      }

      // Resolve businessId from multiple sources
      const businessId =
        req.body.businessId ||
        req.query.businessId ||
        req.user?.businessId ||
        req.params.businessId;

      if (!businessId) {
        // Business Context is required for block checking.
        // If missing, we fail-closed for safety.
        return ErrorHandler(
          "Business information is required to book an appointment.",
          400,
          req,
          res
        );
      }

      // 1. Find the client record to get phone/email for broad matching
      const currentClient = await Client.findById(clientId);
      if (!currentClient) {
        // If no record exists yet, they can't be already blocked.
        return next();
      }

      // 2. Narrow check (on this specific record)
      if (currentClient.appBookingBlocked) {
        const business = await Business.findById(businessId);
        const noShowDate = currentClient.lastNoShowDate
          ? moment(currentClient.lastNoShowDate).format("DD/MM/YYYY")
          : "your last appointment";

        const businessPhone = business?.contactInfo?.phone || business?.phone || "your barber";

        return ErrorHandler(
          `If you are unable to attend an appointment, please cancel in advance by phone. Due to an unexcused no-show on ${noShowDate}, future appointments must be requested personally by calling ${businessPhone}.`,
          403,
          req,
          res
        );
      }

      // 3. Broad check (by phone/email)
      //    Search across ALL records in this business for any blocked record matching this person.
      const comparablePhone = getComparablePhone(currentClient.phone);
      const orConditions = [{ _id: clientId }];
      if (comparablePhone && comparablePhone.length > 0) {
        orConditions.push({ phoneComparable: comparablePhone });
      }
      if (currentClient.email && currentClient.email.length > 0) {
        orConditions.push({ email: currentClient.email.toLowerCase() });
      }

      const clientRegistrationQuery = { business: businessId, $or: orConditions };
      const allPotentialClients = await Client.find(clientRegistrationQuery);
      const blockedClient = allPotentialClients.find((c) => c.appBookingBlocked === true);

      if (blockedClient) {
        const business = await Business.findById(businessId);
        const noShowDate = blockedClient.lastNoShowDate
          ? moment(blockedClient.lastNoShowDate).format("DD/MM/YYYY")
          : "your last appointment";
        const businessPhone = business?.contactInfo?.phone || business?.phone || "your barber";

        return ErrorHandler(
          `If you are unable to attend an appointment, please cancel in advance by phone. Due to an unexcused no-show on ${noShowDate}, future appointments must be requested personally by calling ${businessPhone}.`,
          403,
          req,
          res
        );
      }
    } catch (error) {
      console.error("No-show block check middleware error:", error.message);
      // Fail-closed for safety if we cannot verify status
      return ErrorHandler("Unable to verify booking eligibility. Please try again.", 503, req, res);
    }
  }

  next();
};

module.exports = checkNoShowBlock;
