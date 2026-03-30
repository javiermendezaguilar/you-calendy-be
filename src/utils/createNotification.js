const Notification = require("../models/User/notification");

/**
 * Creates a notification with validated type field
 * @param {Object} user - User object with _id (for barber/admin notifications)
 * @param {string} message - Notification message
 * @param {string} type - Notification type (should be "barber", "client", or "admin")
 * @param {Object} data - Additional notification data
 * @param {Object} client - Client object with _id (for client notifications)
 * @returns {Promise<Object>} Created notification
 */
const createNotification = async (user, message, type, data = {}, client = null) => {
  try {
    // Ensure type is a valid enum value - default to "client" if invalid
    const validTypes = ["barber", "client", "admin"];
    const validType = validTypes.includes(type) ? type : "client";
    
    const notificationData = {
      message,
      type: validType,
      data,
    };
    
    // Add user or client reference based on type
    if (client) {
      notificationData.client = client._id || client;
    }
    if (user) {
      notificationData.user = user._id || user;
    }
    
    const notification = await Notification.create(notificationData);
    
    return notification;
  } catch (error) {
    console.error("Error creating notification:", error.message);
    throw error;
  }
};

module.exports = createNotification;
