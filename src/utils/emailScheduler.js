const EmailCampaign = require("../models/emailCampaign");
const sendMail = require("./sendMail");
const moment = require("moment");
const logger = require("../functions/logger");
const { deductEmailCredits } = require("./creditManager");

/**
 * Process scheduled email campaigns
 * This function should be called by a cron job or scheduler
 */
const processScheduledEmailCampaigns = async () => {
  try {
    logger.info("Processing scheduled email campaigns...");

    // Find all scheduled campaigns that are due to be sent
    const scheduledCampaigns = await EmailCampaign.find({
      status: "scheduled",
      $or: [
        // send_later campaigns with scheduled date in the past
        {
          deliveryType: "send_later",
          scheduledDate: { $lte: new Date() },
        },
        // recurring campaigns with next scheduled date in the past
        {
          deliveryType: "recurring",
          nextScheduledAt: { $lte: new Date() },
        },
      ],
    });

    logger.info(`Found ${scheduledCampaigns.length} campaigns to process`);

    for (const campaign of scheduledCampaigns) {
      try {
        await processEmailCampaign(campaign);
      } catch (error) {
        logger.error(
          `Error processing campaign ${campaign._id}:`,
          error.message
        );

        // Mark campaign as failed
        campaign.status = "failed";
        campaign.errorMessage = error.message;
        await campaign.save();
      }
    }

    logger.info("Finished processing scheduled email campaigns");
  } catch (error) {
    logger.error("Error in processScheduledEmailCampaigns:", error);
  }
};

/**
 * Process a single email campaign
 */
const processEmailCampaign = async (campaign) => {
  if (!campaign.targetEmail) {
    throw new Error("No target email found for campaign");
  }

  try {
    // Deduct email credits before sending
    await deductEmailCredits(campaign.business, 1);

    // Send email
    const emailContent = campaign.imageUrl
      ? `<img src="${campaign.imageUrl}" style="max-width: 100%; height: auto; margin-bottom: 20px;"><br>${campaign.content}`
      : campaign.content;

    await sendMail(campaign.targetEmail, "Email Campaign", emailContent);

    // Update campaign status
    campaign.status = "sent";
    campaign.sentAt = new Date();
    campaign.sentTo = campaign.targetEmail;
    campaign.metadata.totalSent = 1;
    campaign.metadata.creditsUsed = 1;
    campaign.lastSentAt = new Date();

    // For recurring campaigns, calculate next scheduled date
    if (campaign.deliveryType === "recurring" && campaign.recurringInterval) {
      const nextDate = moment().add(campaign.recurringInterval, "days");
      campaign.nextScheduledAt = nextDate.toDate();
      campaign.status = "scheduled"; // Keep it scheduled for next send
    }

    await campaign.save();

    logger.info(
      `Successfully sent campaign ${campaign._id} to ${campaign.targetEmail} using 1 email credit`
    );
  } catch (creditError) {
    logger.error(
      `Insufficient email credits for campaign ${campaign._id}: ${creditError.message}`
    );

    // Mark campaign as failed due to insufficient credits
    campaign.status = "failed";
    campaign.errorMessage = `Insufficient email credits: ${creditError.message}`;
    await campaign.save();

    throw creditError;
  }
};

module.exports = {
  processScheduledEmailCampaigns,
  processEmailCampaign,
};
