const createNotification = require("./createNotification");
const path = require("path");
const {
  loadServiceAccount,
  describeServiceAccountSource,
} = require("./serviceAccount");
const { getGoogleAccessToken } = require("./googleServiceAccountAuth");

const firebaseFallbackPaths = [path.join(__dirname, "fcm.json")];

const firebaseServiceAccount = loadServiceAccount({
  jsonEnvVar: "FIREBASE_SERVICE_ACCOUNT_JSON",
  base64EnvVar: "FIREBASE_SERVICE_ACCOUNT_BASE64",
  filePathEnvVar: "FIREBASE_SERVICE_ACCOUNT_FILE",
  fallbackPaths: firebaseFallbackPaths,
});

const isTest = process.env.NODE_ENV === "test";

if (!isTest) {
  console.log(
    "Firebase service account source:",
    describeServiceAccountSource(
      firebaseServiceAccount.source,
      firebaseFallbackPaths
    )
  );
}

if (
  !isTest &&
  !firebaseServiceAccount.credentials &&
  !firebaseServiceAccount.keyFilename
) {
  console.warn("Firebase service account not configured. Push notifications will be disabled.");
}

const sendNotification = async (user, title, body, type, data) => {
  try {
    // Use centralized notification creation function
    const notification = await createNotification(user, body, type, data);

    if (
      user.deviceToken &&
      user.isNotificationEnabled &&
      (firebaseServiceAccount.credentials || firebaseServiceAccount.keyFilename)
    ) {
      const accessToken = await getGoogleAccessToken({
        ...(firebaseServiceAccount.credentials
          ? { credentials: firebaseServiceAccount.credentials }
          : { keyFilename: firebaseServiceAccount.keyFilename }),
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });

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
