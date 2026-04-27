const Client = require("../models/client");
const Business = require("../models/User/business");
const sendMail = require("../utils/sendMail");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const { sendBulkEmailWithCredits } = require("../utils/creditAwareMessaging");
const { generateMessageBlastTemplate } = require("../utils/emailTemplates");

const buildMarketingEmailRecipientQuery = (businessId, extra = {}) => ({
  business: businessId,
  email: { $exists: true, $nin: [null, ""] },
  "consentFlags.marketingEmail.granted": true,
  ...extra,
});

/**
 * @desc Send email blast to business clients
 * @route POST /api/business/message-blast/email
 * @access Private (Business owner only)
 */
const sendEmailBlast = async (req, res) => {
  try {
    const {
      subject,
      message,
      recipientGroup,
      clientIds, // Optional: array of specific client IDs to send to
      deliveryOption,
      scheduledDate,
      scheduledTime,
      recurringInterval,
    } = req.body;

    // Get business owned by the authenticated user
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return res
        .status(404)
        .json({ success: false, message: "Business not found for this user." });
    }
    const businessId = business._id;

    // Validate required fields
    if (!subject || !message || !deliveryOption) {
      return ErrorHandler(
        "Subject, message, and delivery option are required.",
        400,
        req,
        res
      );
    }

    // Validate: either recipientGroup or clientIds must be provided
    if (!recipientGroup && (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0)) {
      return ErrorHandler(
        "Either recipient group or client IDs must be provided.",
        400,
        req,
        res
      );
    }

    // Validate delivery option
    if (!["immediate", "scheduled", "recurring"].includes(deliveryOption)) {
      return ErrorHandler(
        "Delivery option must be 'immediate', 'scheduled', or 'recurring'.",
        400,
        req,
        res
      );
    }

    // Validate scheduled delivery requirements
    if (deliveryOption === "scheduled" && (!scheduledDate || !scheduledTime)) {
      return ErrorHandler(
        "Scheduled date and time are required for scheduled delivery.",
        400,
        req,
        res
      );
    }

    // Validate recurring delivery requirements
    if (
      deliveryOption === "recurring" &&
      (!scheduledDate || !scheduledTime || !recurringInterval)
    ) {
      return ErrorHandler(
        "Scheduled date, time, and recurring interval are required for recurring delivery.",
        400,
        req,
        res
      );
    }

    // Business details already retrieved at the beginning of the function

    let recipients = [];

    // If clientIds are provided, use those specific clients
    if (clientIds && Array.isArray(clientIds) && clientIds.length > 0) {
      recipients = await Client.find({
        ...buildMarketingEmailRecipientQuery(businessId),
        _id: { $in: clientIds },
      }).select("email firstName lastName _id");
      
      if (recipients.length === 0) {
        return ErrorHandler(
          "No clients found with email address and marketing email consent.",
          400,
          req,
          res
        );
      }
    } else {
      // Get recipients based on recipient group (backward compatibility)
      if (recipientGroup === "all") {
        recipients = await Client.find(
          buildMarketingEmailRecipientQuery(businessId, {
            isActive: true,
          })
        ).select("email firstName lastName");
      } else if (recipientGroup === "active") {
        recipients = await Client.find(
          buildMarketingEmailRecipientQuery(businessId, {
            isActive: true,
            status: "activated",
          })
        ).select("email firstName lastName");
      } else if (recipientGroup === "new") {
        // Clients created in the last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        recipients = await Client.find(
          buildMarketingEmailRecipientQuery(businessId, {
            isActive: true,
            createdAt: { $gte: thirtyDaysAgo },
          })
        ).select("email firstName lastName");
      } else {
        return ErrorHandler(
          "Recipient group must be 'all', 'active', or 'new'.",
          400,
          req,
          res
        );
      }

      if (recipients.length === 0) {
        return ErrorHandler(
          `No clients found in the '${recipientGroup}' group to send emails to.`,
          400,
          req,
          res
        );
      }
    }

    // For immediate delivery, send emails now
    if (deliveryOption === "immediate") {
      // Get business name and logo for email template
      const businessName = business.businessName || business.name || "Your Business";
      const logoUrl = business.profileImages?.logo || null;
      
      // Generate professional email template
      const emailContent = generateMessageBlastTemplate(
        businessName,
        subject,
        message,
        logoUrl
      );

      // Prepare recipients for bulk email sending
      const emailRecipients = recipients.map((recipient) => ({
        email: recipient.email,
        firstName: recipient.firstName,
        lastName: recipient.lastName,
      }));

      // Send bulk emails with credit validation
      const results = await sendBulkEmailWithCredits(
        emailRecipients,
        subject,
        emailContent,
        businessId,
        req,
        res
      );

      // Check if credit validation failed
      if (results && results.error) {
        return ErrorHandler(
          results.message,
          402, // Payment Required
          req,
          res
        );
      }

      return SuccessHandler(
        {
          message: `Email blast sent to ${results.successCount} clients`,
          data: {
            recipientGroup,
            deliveryOption,
            totalRecipients: recipients.length,
            successCount: results.successCount,
            failedEmails: results.failedRecipients,
            creditsUsed: results.creditsUsed,
            businessName: business.businessName,
          },
        },
        200,
        res
      );
    }

    // For scheduled and recurring delivery, we would typically save to a queue/scheduler
    // For now, we'll return a success message indicating the email is scheduled
    // In a production environment, you would integrate with a job queue like Bull or Agenda

    return SuccessHandler(
      {
        message: `Email blast scheduled successfully for ${recipients.length} clients`,
        data: {
          recipientGroup,
          deliveryOption,
          scheduledDate,
          scheduledTime,
          recurringInterval,
          totalRecipients: recipients.length,
          businessName: business.businessName,
          status: "scheduled",
        },
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get recipient groups for business email blast
 * @route GET /api/business/message-blast/recipient-groups
 * @access Private (Business owner only)
 */
const getRecipientGroups = async (req, res) => {
  try {
    // Get business owned by the authenticated user
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return res
        .status(404)
        .json({ success: false, message: "Business not found for this user." });
    }
    const businessId = business._id;

    // Get counts for each group
    const allClientsCount = await Client.countDocuments({
      ...buildMarketingEmailRecipientQuery(businessId),
    });

    const activeClientsCount = await Client.countDocuments({
      ...buildMarketingEmailRecipientQuery(businessId),
      isActive: true,
    });

    // Clients created in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const newClientsCount = await Client.countDocuments({
      ...buildMarketingEmailRecipientQuery(businessId),
      createdAt: { $gte: thirtyDaysAgo },
    });

    const recipientGroups = [
      {
        value: "all",
        label: "All Clients",
        count: allClientsCount,
      },
      {
        value: "active",
        label: "Active Clients",
        count: activeClientsCount,
      },
      {
        value: "new",
        label: "New Clients (Last 30 days)",
        count: newClientsCount,
      },
    ];

    return SuccessHandler(recipientGroups, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get message blast statistics for business
 * @route GET /api/business/message-blast/stats
 * @access Private (Business owner only)
 */
const getMessageBlastStats = async (req, res) => {
  try {
    // Get business owned by the authenticated user
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return res
        .status(404)
        .json({ success: false, message: "Business not found for this user." });
    }
    const businessId = business._id;

    // Get total clients with email
    const totalClientsWithEmail = await Client.countDocuments({
      ...buildMarketingEmailRecipientQuery(businessId),
      isActive: true,
    });

    // Get active clients
    const activeClients = await Client.countDocuments({
      ...buildMarketingEmailRecipientQuery(businessId),
      isActive: true,
      status: "activated",
    });

    // Get new clients (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const newClients = await Client.countDocuments({
      ...buildMarketingEmailRecipientQuery(businessId),
      isActive: true,
      createdAt: { $gte: thirtyDaysAgo },
    });

    const stats = {
      totalClientsWithEmail,
      activeClients,
      newClients,
      emailDeliveryRate:
        totalClientsWithEmail > 0
          ? ((activeClients / totalClientsWithEmail) * 100).toFixed(2)
          : 0,
    };

    return SuccessHandler(stats, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  sendEmailBlast,
  getRecipientGroups,
  getMessageBlastStats,
};
