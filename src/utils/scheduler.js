const cron = require("cron");
const { processScheduledEmailCampaigns } = require("./emailScheduler");
const { processAppointmentReminders } = require("./appointmentReminderProcessor");
const logger = require("../functions/logger");

/**
 * Email Campaign Scheduler
 * Handles scheduled and recurring email campaigns using cron jobs
 */
class EmailCampaignScheduler {
  constructor() {
    this.jobs = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize the email campaign scheduler
   * Runs every 5 minutes to process scheduled campaigns
   */
  initialize() {
    if (this.isInitialized) {
      logger.info("Email campaign scheduler already initialized");
      return;
    }

    try {
      // Schedule email campaign processing every 5 minutes
      const emailCampaignJob = new cron.CronJob(
        "*/5 * * * *", // Every 5 minutes
        async () => {
          logger.info("Running scheduled email campaign processor");
          try {
            await processScheduledEmailCampaigns();
            logger.info("Email campaign processor completed successfully");
          } catch (error) {
            logger.error("Email campaign processor failed:", error);
          }
        },
        null,
        false, // Don't start immediately
        "UTC"
      );

      // Store the job reference
      this.jobs.set("emailCampaigns", emailCampaignJob);

      // Schedule appointment reminder processing every 15 minutes
      const appointmentReminderJob = new cron.CronJob(
        "*/15 * * * *", // Every 15 minutes
        async () => {
          logger.info("Running scheduled appointment reminder processor");
          try {
            await processAppointmentReminders();
            logger.info("Appointment reminder processor completed successfully");
          } catch (error) {
            logger.error("Appointment reminder processor failed:", error);
          }
        },
        null,
        false, // Don't start immediately
        "UTC"
      );

      // Store the job reference
      this.jobs.set("appointmentReminders", appointmentReminderJob);

      // Start the jobs
      emailCampaignJob.start();
      appointmentReminderJob.start();

      this.isInitialized = true;
      logger.info("Email campaign scheduler initialized successfully");
      logger.info("Appointment reminder scheduler initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize email campaign scheduler:", error);
      throw error;
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stop() {
    try {
      for (const [name, job] of this.jobs) {
        job.stop();
        logger.info(`Stopped scheduler job: ${name}`);
      }
      this.jobs.clear();
      this.isInitialized = false;
      logger.info("All scheduler jobs stopped");
    } catch (error) {
      logger.error("Error stopping scheduler jobs:", error);
    }
  }

  /**
   * Get status of all jobs
   */
  getStatus() {
    const status = {};
    for (const [name, job] of this.jobs) {
      status[name] = {
        running: job.running,
        nextDate: job.nextDate(),
        lastDate: job.lastDate(),
      };
    }
    return status;
  }

  /**
   * Manually trigger email campaign processing
   */
  async triggerEmailCampaignProcessing() {
    try {
      logger.info("Manually triggering email campaign processing");
      await processScheduledEmailCampaigns();
      logger.info("Manual email campaign processing completed");
      return { success: true, message: "Email campaign processing completed" };
    } catch (error) {
      logger.error("Manual email campaign processing failed:", error);
      return { success: false, error: error.message };
    }
  }
}

// Create singleton instance
const emailCampaignScheduler = new EmailCampaignScheduler();

module.exports = {
  emailCampaignScheduler,
  EmailCampaignScheduler,
};
