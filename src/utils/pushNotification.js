const admin = require("firebase-admin");
const serviceAccount = require("./fcm.json");
const createNotification = require("./createNotification");
const { google } = require("googleapis");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const sendNotification = async (user, title, body, type, data) => {
  try {
    // Use centralized notification creation function
    const notification = await createNotification(user, body, type, data);

    if (user.deviceToken && user.isNotificationEnabled) {
      const auth = new google.auth.GoogleAuth({
        keyFile: "./src/utils/fcm.json",
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      const accessToken = await auth.getAccessToken();

      const message = {
        notification: {
          title: title,
          body: body,
        },
        data: {
          data: JSON.stringify(data),
        },
        token: user.deviceToken,
      };
      const response = await fetch(
        "https://fcm.googleapis.com/v1/projects/barbermanagement-42d90/messages:send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: message }),
        }
      );
      const jsonResponse = await response.json();
      // Successfully sent push notification
    }
  } catch (error) {
    console.error("Error sending push notification:", error.message);
    throw error;
  }
};
module.exports = sendNotification;
