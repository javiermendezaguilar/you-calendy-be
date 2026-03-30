const User = require("../models/User/user");
const sendNotification = require("./pushNotification");

/**
 * Get all active admin users
 * @returns {Promise<Array>} Array of admin users
 */
const getAdminUsers = async () => {
  try {
    const adminUsers = await User.find({
      role: "admin",
      isActive: true,
      // status: "activated",
    }).select("_id name email deviceToken isNotificationEnabled");

    return adminUsers;
  } catch (error) {
    console.error("Error fetching admin users:", error.message);
    return [];
  }
};

/**
 * Send notification to all admin users
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {string} type - Notification type
 * @param {Object} data - Additional notification data
 * @returns {Promise<number>} Number of notifications sent
 */
const sendNotificationToAdmins = async (title, body, type, data = {}) => {
  try {
    const adminUsers = await getAdminUsers();
    let notificationsSent = 0;

    for (const admin of adminUsers) {
      try {
        await sendNotification(admin, title, body, type, data);
        notificationsSent++;
      } catch (error) {
        console.error(
          `Failed to send notification to admin ${admin._id}:`,
          error.message
        );
      }
    }

    return notificationsSent;
  } catch (error) {
    console.error("Error sending notifications to admins:", error.message);
    return 0;
  }
};

module.exports = {
  getAdminUsers,
  sendNotificationToAdmins,
};
