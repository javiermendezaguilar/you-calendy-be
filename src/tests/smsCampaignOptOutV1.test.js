const request = require("supertest");

jest.mock("../utils/twilio", () => ({
  sendSMS: jest.fn(),
}));

const app = require("../app");
const Business = require("../models/User/business");
const Client = require("../models/client");
const SmsCampaign = require("../models/smsCampaign");
const { sendSMS } = require("../utils/twilio");
const {
  SMS_SKIP_REASONS,
} = require("../services/messaging/smsPolicy");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");

const createSmsClient = (fixture, overrides = {}) =>
  Client.create({
    business: fixture.business._id,
    firstName: overrides.firstName || "SMS",
    lastName: overrides.lastName || "Client",
    phone: overrides.phone,
    isActive: true,
    status: "activated",
    notificationsEnabled: overrides.notificationsEnabled,
    consentFlags: overrides.consentFlags,
  });

const postSmsCampaign = (fixture, payload) =>
  request(app)
    .post("/business/sms-campaigns")
    .set("Authorization", `Bearer ${fixture.token}`)
    .send(payload);

describe("BE-P1-32 SMS campaigns opt-out contract", () => {
  let fixture;

  beforeAll(async () => {
    await connectCommerceTestDatabase();
  });

  afterAll(async () => {
    await disconnectCommerceTestDatabase();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await SmsCampaign.deleteMany({});
    fixture = await createCommerceFixture();
    fixture.business.smsCredits = 5;
    await fixture.business.save();
    sendSMS.mockResolvedValue({
      sid: "SM_CONSENTED",
      messageId: "SM_CONSENTED",
      provider: "twilio",
      attempts: 1,
    });
  });

  test("send_now sends only to marketing-SMS consented clients and records skipped recipients", async () => {
    const eligible = await createSmsClient(fixture, {
      firstName: "Allowed",
      phone: "+34666001001",
      consentFlags: {
        marketingSms: { granted: true, source: "owner_update" },
      },
    });
    const missingConsent = await createSmsClient(fixture, {
      firstName: "NoConsent",
      phone: "+34666001002",
    });
    const optedOut = await createSmsClient(fixture, {
      firstName: "OptedOut",
      phone: "+34666001003",
      notificationsEnabled: false,
      consentFlags: {
        marketingSms: { granted: true, source: "owner_update" },
      },
    });

    const res = await postSmsCampaign(fixture, {
      content: "Promo de prueba",
      deliveryType: "send_now",
      clientIds: [
        eligible._id.toString(),
        missingConsent._id.toString(),
        optedOut._id.toString(),
      ],
    });

    expect(res.status).toBe(201);
    expect(sendSMS).toHaveBeenCalledTimes(1);
    expect(sendSMS).toHaveBeenCalledWith("+34666001001", "Promo de prueba");

    const campaign = await SmsCampaign.findById(res.body.data.campaign._id);
    expect(campaign.status).toBe("sent");
    expect(campaign.sentTo).toBe("+34666001001");
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
          reason: SMS_SKIP_REASONS.MISSING_MARKETING_SMS_CONSENT,
        },
        {
          client: optedOut._id.toString(),
          reason: SMS_SKIP_REASONS.CLIENT_OPTED_OUT,
        },
      ])
    );

    const business = await Business.findById(fixture.business._id);
    expect(business.smsCredits).toBe(4);
  });

  test("send_now rejects all-skipped recipient sets without consuming credits", async () => {
    const missingConsent = await createSmsClient(fixture, {
      firstName: "NoConsent",
      phone: "+34666001004",
    });
    const optedOut = await createSmsClient(fixture, {
      firstName: "OptedOut",
      phone: "+34666001005",
      notificationsEnabled: false,
      consentFlags: {
        marketingSms: { granted: true, source: "owner_update" },
      },
    });

    const res = await postSmsCampaign(fixture, {
      content: "Promo bloqueada",
      deliveryType: "send_now",
      clientIds: [missingConsent._id.toString(), optedOut._id.toString()],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "No SMS recipients have marketing SMS consent and notifications enabled."
    );
    expect(sendSMS).not.toHaveBeenCalled();
    expect(await SmsCampaign.countDocuments({})).toBe(0);

    const business = await Business.findById(fixture.business._id);
    expect(business.smsCredits).toBe(5);
  });
});
