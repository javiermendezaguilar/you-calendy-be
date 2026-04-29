describe("push notification auth dependency", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "firebase-adminsdk@test.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----\\n",
      project_id: "barbermanagement-42d90",
    });
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ name: "projects/test/messages/1" }),
    });
  });

  afterEach(() => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    global.fetch = originalFetch;
    jest.dontMock("../utils/createNotification");
    jest.dontMock("../utils/googleServiceAccountAuth");
  });

  test("uses service account OAuth token to send FCM HTTP v1 notifications", async () => {
    const createNotification = jest.fn().mockResolvedValue({ _id: "notification-1" });
    const getGoogleAccessToken = jest.fn().mockResolvedValue("access-token-1");

    jest.doMock("../utils/createNotification", () => createNotification);
    jest.doMock("../utils/googleServiceAccountAuth", () => ({ getGoogleAccessToken }));

    const sendNotification = require("../utils/pushNotification");

    await sendNotification(
      { _id: "user-1", deviceToken: "device-token-1", isNotificationEnabled: true },
      "Booking updated",
      "Your appointment changed",
      "client",
      { appointmentId: "appointment-1" }
    );

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "user-1" }),
      "Your appointment changed",
      "client",
      { appointmentId: "appointment-1" }
    );
    expect(getGoogleAccessToken).toHaveBeenCalledWith({
      credentials: expect.objectContaining({ project_id: "barbermanagement-42d90" }),
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    expect(getGoogleAccessToken).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://fcm.googleapis.com/v1/projects/barbermanagement-42d90/messages:send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer access-token-1",
          "Content-Type": "application/json",
        }),
      })
    );
  });
});
