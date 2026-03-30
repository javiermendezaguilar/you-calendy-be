const { adminNotificationSocket } = require("../functions/socketFunctions");
const createNotification = require("./createNotification");

const adminNotification = async (user, title, body, type, data) => {
  try {
    // Use centralized notification creation function
    const notification = await createNotification(user, body, type, data);

    await adminNotificationSocket(user._id, {
      title: title,
      body: body,
      type: notification.type, // Use the validated type from the created notification
      data: data,
    });
  } catch (error) {
    console.error("Error sending message:", error.message);
  }
};

module.exports = adminNotification;
