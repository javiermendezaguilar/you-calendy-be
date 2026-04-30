const request = require("supertest");

jest.mock("../utils/sendMail", () => jest.fn());

const app = require("../app");
const Business = require("../models/User/business");
const Client = require("../models/client");
const EmailCampaign = require("../models/emailCampaign");
const sendMail = require("../utils/sendMail");
const {
  EMAIL_SKIP_REASONS,
} = require("../services/messaging/emailPolicy");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");

const createEmailClient = (fixture, overrides = {}) =>
  Client.create({
    business: fixture.business._id,
    firstName: overrides.firstName || "Email",
    lastName: overrides.lastName || "Client",
    phone: overrides.phone || "+34666002000",
    email: overrides.email,
    isActive: true,
    status: "activated",
    notificationsEnabled: overrides.notificationsEnabled,
    consentFlags: overrides.consentFlags,
  });

const postEmailCampaign = (fixture, payload) =>
  request(app)
    .post("/business/email-campaigns")
    .set("Authorization", `Bearer ${fixture.token}`)
    .send(payload);

describe("BE-P1-33 email campaigns opt-out contract", () => {
  let fixture;

  beforeAll(async () => {
    await connectCommerceTestDatabase();
  });

  afterAll(async () => {
    await disconnectCommerceTestDatabase();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await EmailCampaign.deleteMany({});
    fixture = await createCommerceFixture();
    fixture.client.isActive = false;
    await fixture.client.save();
    fixture.business.emailCredits = 5;
    await fixture.business.save();
    sendMail.mockResolvedValue({
      messageId: "BREVO_CONSENTED",
      provider: "brevo",
      attempts: 1,
    });
  });

  test("send_now sends only to marketing-email consented clients and records skipped recipients", async () => {
    const eligible = await createEmailClient(fixture, {
      firstName: "Allowed",
      phone: "+34666002001",
      email: "allowed@example.com",
      consentFlags: {
        marketingEmail: { granted: true, source: "owner_update" },
      },
    });
    const missingConsent = await createEmailClient(fixture, {
      firstName: "NoConsent",
      phone: "+34666002002",
      email: "no-consent@example.com",
    });
    const optedOut = await createEmailClient(fixture, {
      firstName: "OptedOut",
      phone: "+34666002003",
      email: "opted-out@example.com",
      notificationsEnabled: false,
      consentFlags: {
        marketingEmail: { granted: true, source: "owner_update" },
      },
    });

    const res = await postEmailCampaign(fixture, {
      content: "<p>Promo de prueba</p>",
      deliveryType: "send_now",
    });

    expect(res.status).toBe(201);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      "allowed@example.com",
      "Email from Commerce Shop",
      "<p>Promo de prueba</p>"
    );

    const campaign = await EmailCampaign.findById(res.body.data.campaign._id);
    expect(campaign.status).toBe("sent");
    expect(campaign.sentTo).toBe("allowed@example.com");
    expect(campaign.metadata.totalSent).toBe(1);
    expect(campaign.metadata.totalFailed).toBe(0);
    expect(campaign.metadata.creditsUsed).toBe(1);
    expect(campaign.metadata.creditsRefunded).toBe(0);
    expect(campaign.metadata.totalSkipped).toBe(2);
    expect(
      campaign.metadata.skippedRecipients.map((recipient) => ({
        client: recipient.client.toString(),
        reason: recipient.reason,
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          client: missingConsent._id.toString(),
          reason: EMAIL_SKIP_REASONS.MISSING_MARKETING_EMAIL_CONSENT,
        },
        {
          client: optedOut._id.toString(),
          reason: EMAIL_SKIP_REASONS.CLIENT_OPTED_OUT,
        },
      ])
    );

    const business = await Business.findById(fixture.business._id);
    expect(business.emailCredits).toBe(4);
    expect(eligible.email).toBe("allowed@example.com");
  });

  test("send_now rejects all-skipped recipient sets without consuming credits", async () => {
    await createEmailClient(fixture, {
      firstName: "NoConsent",
      phone: "+34666002004",
      email: "blocked@example.com",
    });
    await createEmailClient(fixture, {
      firstName: "OptedOut",
      phone: "+34666002005",
      email: "opted-out-two@example.com",
      notificationsEnabled: false,
      consentFlags: {
        marketingEmail: { granted: true, source: "owner_update" },
      },
    });

    const res = await postEmailCampaign(fixture, {
      content: "<p>Promo bloqueada</p>",
      deliveryType: "send_now",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "No email recipients have marketing email consent and notifications enabled."
    );
    expect(sendMail).not.toHaveBeenCalled();
    expect(await EmailCampaign.countDocuments({})).toBe(0);

    const business = await Business.findById(fixture.business._id);
    expect(business.emailCredits).toBe(5);
  });
});
