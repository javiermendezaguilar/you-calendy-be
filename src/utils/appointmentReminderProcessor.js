const Appointment = require("../models/appointment");
const Business = require("../models/User/business");
const { sendSMSWithCredits } = require("../utils/creditAwareMessaging");
const logger = require("../functions/logger");

/**
 * Process appointment reminders for all businesses
 * This function should be called by a cron job or scheduler
 */
const processAppointmentReminders = async () => {
  try {
    logger.info("Processing appointment reminders for all businesses...");

    // Map enum to hours
    const reminderMap = {
      "1_hour_before": 1,
      "2_hours_before": 2,
      "3_hours_before": 3,
      "4_hours_before": 4,
    };

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    // Find all businesses
    const businesses = await Business.find({});
    logger.info(`Found ${businesses.length} businesses to process`);

    let totalRemindersSent = 0;
    let totalBusinessesProcessed = 0;

    // Process reminders for each business
    for (const business of businesses) {
      try {
        // Query for appointments that need reminders
        const query = {
          business: business._id,
          status: { $in: ["Pending", "Confirmed"] },
          date: { $gte: startOfToday },
          appointmentReminder: true,
          reminderTime: { $in: Object.keys(reminderMap) },
        };

        const appointments = await Appointment.find(query).populate(
          "client",
          "firstName lastName email phone isActive status"
        );

        if (appointments.length === 0) {
          continue; // Skip if no appointments
        }

        let businessRemindersSent = 0;

        for (const appt of appointments) {
          // Only send to active/activated clients with a phone number
          if (
            !appt.client ||
            !appt.client.phone ||
            !appt.client.isActive ||
            appt.client.status !== "activated"
          ) {
            continue;
          }

          // Calculate the reminder window for this appointment
          const hoursBefore = reminderMap[appt.reminderTime];

          // Skip if reminderTime is invalid
          if (!hoursBefore || !appt.reminderTime) {
            continue;
          }

          // Create appointment date-time
          const apptDateTime = new Date(appt.date);
          const [h, m] = appt.startTime.split(":");
          apptDateTime.setHours(parseInt(h, 10));
          apptDateTime.setMinutes(parseInt(m, 10));
          apptDateTime.setSeconds(0, 0);
          apptDateTime.setMilliseconds(0);

          // Calculate when the reminder should be sent (X hours before appointment)
          const reminderTargetTime = new Date(
            apptDateTime.getTime() - hoursBefore * 60 * 60 * 1000
          );

          // Reminder window: 30 minutes before and 30 minutes after the target time
          const reminderWindowStart = new Date(
            reminderTargetTime.getTime() - 30 * 60 * 1000
          );
          const reminderWindowEnd = new Date(
            reminderTargetTime.getTime() + 30 * 60 * 1000
          );

          // Check if current time is within the reminder window
          if (now >= reminderWindowStart && now < reminderWindowEnd) {
            try {
              // Format appointment date for message
              const appointmentDateStr = appt.date.toLocaleDateString("en-US", {
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
              });

              // Create a mock req/res object for sendSMSWithCredits
              // Since we're in a cron context, we'll create minimal objects
              const mockReq = {
                user: { id: business.owner },
              };
              const mockRes = {
                status: () => mockRes,
                json: () => {},
              };

              // Send SMS with credit validation
              const smsResult = await sendSMSWithCredits(
                appt.client.phone,
                `${
                  appt.messageReminder || "Appointment Reminder"
                } - Your appointment is at ${appt.startTime} on ${appointmentDateStr}`,
                appt.business,
                mockReq,
                mockRes
              );

              // Check if SMS was sent successfully
              if (smsResult && smsResult.success && !smsResult.error) {
                businessRemindersSent++;
                totalRemindersSent++;
                logger.info(
                  `Reminder SMS sent successfully to ${appt.client.phone} for appointment ${appt._id}`
                );
              } else {
                logger.warn(
                  `Failed to send reminder SMS to ${appt.client.phone}: ${
                    smsResult?.message || smsResult?.error || "Unknown error"
                  }`
                );
              }
            } catch (smsError) {
              logger.error(
                `Error sending reminder SMS for appointment ${appt._id}:`,
                smsError.message
              );
            }
          }
        }

        if (businessRemindersSent > 0) {
          totalBusinessesProcessed++;
          logger.info(
            `Sent ${businessRemindersSent} reminder(s) for business ${business._id}`
          );
        }
      } catch (businessError) {
        logger.error(
          `Error processing reminders for business ${business._id}:`,
          businessError.message
        );
      }
    }

    logger.info(
      `Appointment reminder processing completed. Sent ${totalRemindersSent} reminder(s) across ${totalBusinessesProcessed} business(es)`
    );

    return {
      success: true,
      totalRemindersSent,
      totalBusinessesProcessed,
    };
  } catch (error) {
    logger.error("Error in processAppointmentReminders:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

module.exports = {
  processAppointmentReminders,
};

