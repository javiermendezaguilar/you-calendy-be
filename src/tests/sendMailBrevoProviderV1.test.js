jest.mock("nodemailer", () => ({
  createTransport: jest.fn(),
}));

jest.mock("nodemailer-brevo-transport", () =>
  jest.fn().mockImplementation(function BrevoTransport(config) {
    this.config = config;
  })
);

jest.mock("../models/apiKey", () => ({
  getActiveConfig: jest.fn(),
}));

const nodemailer = require("nodemailer");
const Transport = require("nodemailer-brevo-transport");
const ApiKey = require("../models/apiKey");
const sendMail = require("../utils/sendMail");

describe("BE-P1-33 Brevo email provider contract", () => {
  let providerSendMail;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NODEMAILER_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_FROM_NAME;
    providerSendMail = jest.fn().mockResolvedValue({ messageId: "BREVO-1" });
    nodemailer.createTransport.mockReturnValue({
      sendMail: providerSendMail,
    });
    ApiKey.getActiveConfig.mockResolvedValue(null);
  });

  test("fails with a normalized provider error when Brevo config is missing", async () => {
    await expect(
      sendMail("client@example.com", "Subject", "<p>Hello</p>")
    ).rejects.toMatchObject({
      provider: "brevo",
      code: "BREVO_CONFIG_MISSING",
      status: 503,
      retryable: false,
      attempts: 0,
    });

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(providerSendMail).not.toHaveBeenCalled();
  });

  test("uses environment config and returns provider metadata on success", async () => {
    process.env.NODEMAILER_API_KEY = "env-brevo-key";
    process.env.EMAIL_FROM_ADDRESS = "hello@groomnest.com";
    process.env.EMAIL_FROM_NAME = "Groomnest Ops";

    const result = await sendMail(
      " client@example.com ",
      "  Welcome  ",
      "<p>Hello</p>"
    );

    expect(Transport).toHaveBeenCalledWith({ apiKey: "env-brevo-key" });
    expect(nodemailer.createTransport.mock.calls[0][0].config.apiKey).toBe(
      "env-brevo-key"
    );
    expect(providerSendMail).toHaveBeenCalledWith({
      from: '"Groomnest Ops" hello@groomnest.com',
      to: "client@example.com",
      subject: "Welcome",
      html: "<p>Hello</p>",
    });
    expect(result).toMatchObject({
      provider: "brevo",
      messageId: "BREVO-1",
      attempts: 1,
    });
  });

  test("sanitizes campaign HTML before handing it to Brevo", async () => {
    process.env.NODEMAILER_API_KEY = "env-brevo-key";

    await sendMail(
      "client@example.com",
      "Subject",
      '<p>Hello</p><img src="javascript:alert(1)" onerror="alert(1)"><script>alert(1)</script>'
    );

    expect(providerSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: "<p>Hello</p><img />",
      })
    );
  });

  test("prefers active database config and updates usage after a successful send", async () => {
    process.env.NODEMAILER_API_KEY = "env-brevo-key";
    const updateUsage = jest.fn().mockResolvedValue(undefined);
    ApiKey.getActiveConfig.mockResolvedValue({
      nodemailerApiKey: "db-brevo-key",
      updateUsage,
    });

    await sendMail("client@example.com", "Subject", "<p>Hello</p>");

    expect(Transport).toHaveBeenCalledWith({ apiKey: "db-brevo-key" });
    expect(updateUsage).toHaveBeenCalledTimes(1);
  });

  test("does not fail a delivered email when API key usage tracking fails", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const updateUsage = jest.fn().mockRejectedValue(new Error("usage store down"));
    ApiKey.getActiveConfig.mockResolvedValue({
      nodemailerApiKey: "db-brevo-key",
      updateUsage,
    });

    const result = await sendMail("client@example.com", "Subject", "<p>Hello</p>");

    expect(result).toMatchObject({
      provider: "brevo",
      messageId: "BREVO-1",
      attempts: 1,
    });
    expect(updateUsage).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to update Brevo API key usage:",
      "usage store down"
    );

    warnSpy.mockRestore();
  });

  test("normalizes provider failures without leaking config", async () => {
    process.env.NODEMAILER_API_KEY = "env-brevo-key";
    const providerError = new Error("Invalid API key");
    providerError.code = "EAUTH";
    providerError.statusCode = 401;
    providerSendMail.mockRejectedValue(providerError);

    await expect(
      sendMail("client@example.com", "Subject", "<p>Hello</p>")
    ).rejects.toMatchObject({
      provider: "brevo",
      code: "EAUTH",
      status: 401,
      retryable: false,
      attempts: 1,
    });
  });
});
