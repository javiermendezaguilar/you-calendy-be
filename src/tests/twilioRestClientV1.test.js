const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

describe("twilio REST SMS client", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    process.env = {
      ...ORIGINAL_ENV,
      TWILIO_ACCOUNT_SID: "AC_test_account",
      TWILIO_AUTH_TOKEN: "test-token",
      TWILIO_FROM_NUMBER: "+15551234567",
    };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  it("posts SMS messages to Twilio REST API with the existing contract", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({ sid: "SM123" }),
    });

    const { sendSMS } = require("../utils/twilio");

    const result = await sendSMS("34600000000", "Hola");

    expect(result).toMatchObject({
      sid: "SM123",
      messageId: "SM123",
      provider: "twilio",
      attempts: 1,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC_test_account/Messages.json"
    );
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from("AC_test_account:test-token").toString("base64")}`
    );
    expect(options.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(options.body.get("Body")).toBe("Hola");
    expect(options.body.get("From")).toBe("+15551234567");
    expect(options.body.get("To")).toBe("+34600000000");
  });

  it("preserves Twilio error details for callers", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: jest
        .fn()
        .mockResolvedValue({ code: 20003, message: "Authenticate" }),
    });

    const { sendSMS } = require("../utils/twilio");

    await expect(sendSMS("+34600000000", "Hola")).rejects.toMatchObject({
      message: "Authenticate",
      code: 20003,
      status: 401,
      provider: "twilio",
      retryable: false,
      attempts: 1,
    });
  });

  it("fails before calling Twilio when provider config is incomplete", async () => {
    delete process.env.TWILIO_FROM_NUMBER;

    const { sendSMS } = require("../utils/twilio");

    await expect(sendSMS("+34600000000", "Hola")).rejects.toMatchObject({
      code: "TWILIO_CONFIG_MISSING",
      status: 503,
      provider: "twilio",
      retryable: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("retries only explicit transient Twilio HTTP responses", async () => {
    process.env.TWILIO_MAX_RETRIES = "1";
    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: jest
          .fn()
          .mockResolvedValue({ code: 20429, message: "Temporary unavailable" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: jest.fn().mockResolvedValue({ sid: "SM_RETRY" }),
      });

    const { sendSMS } = require("../utils/twilio");

    const result = await sendSMS("+34600000000", "Hola");

    expect(result).toMatchObject({
      sid: "SM_RETRY",
      messageId: "SM_RETRY",
      provider: "twilio",
      attempts: 2,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry ambiguous network errors", async () => {
    process.env.TWILIO_MAX_RETRIES = "1";
    global.fetch.mockRejectedValue(new Error("socket hang up"));

    const { sendSMS } = require("../utils/twilio");

    await expect(sendSMS("+34600000000", "Hola")).rejects.toMatchObject({
      message: "socket hang up",
      code: "TWILIO_NETWORK_ERROR",
      provider: "twilio",
      retryable: false,
      attempts: 1,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
