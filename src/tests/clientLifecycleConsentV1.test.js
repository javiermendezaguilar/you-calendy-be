const request = require("supertest");
const mongoose = require("mongoose");

jest.mock("../utils/sendMail", () => jest.fn().mockResolvedValue({ ok: true }));
jest.mock("../utils/twilio", () => ({
  sendSMS: jest.fn().mockResolvedValue({ success: true }),
}));

const app = require("../app");
const Client = require("../models/client");
const Payment = require("../models/payment");
const sendMail = require("../utils/sendMail");
const { sendSMS } = require("../utils/twilio");
const {
  PAYMENT_SCOPE,
} = require("../services/payment/paymentScope");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
  createClosedCheckoutForFixture,
} = require("./helpers/commerceFixture");

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const createPaymentForClient = async (fixture, overrides = {}) => {
  return Payment.create({
    paymentScope: overrides.paymentScope || PAYMENT_SCOPE.COMMERCE_CHECKOUT,
    checkout: overrides.checkout || new mongoose.Types.ObjectId(),
    appointment: overrides.appointment || new mongoose.Types.ObjectId(),
    business: fixture.business._id,
    client: overrides.client || fixture.client._id,
    staff: fixture.staff._id,
    status: overrides.status || "captured",
    method: "card_manual",
    currency: "EUR",
    amount: overrides.amount ?? 40,
    capturedAt: overrides.capturedAt || new Date(),
    capturedBy: fixture.owner._id,
    snapshot: {
      subtotal: 35,
      discountTotal: 0,
      total: 40,
      sourcePrice: 35,
      client: {
        id: overrides.client || fixture.client._id,
        firstName: "Lifecycle",
        lastName: "Client",
      },
      serviceLines: [],
    },
  });
};

describe("BE-P1-15 client lifecycle and consent", () => {
  let fixture;

  beforeAll(async () => {
    await connectCommerceTestDatabase();
  });

  afterAll(async () => {
    await disconnectCommerceTestDatabase();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    fixture = await createCommerceFixture();
  });

  test("creates clients with new lifecycle and no inferred consent", async () => {
    const client = await Client.findById(fixture.client._id);

    expect(client.lifecycleStatus).toBe("new");
    expect(client.firstPaidVisitAt).toBeNull();
    expect(client.lastPaidVisitAt).toBeNull();
    expect(client.consentFlags.marketingEmail.granted).toBe(false);
    expect(client.consentFlags.marketingSms.granted).toBe(false);
    expect(client.consentFlags.transactionalEmail.granted).toBe(false);
    expect(client.consentFlags.transactionalSms.granted).toBe(false);
  });

  test("refreshes lifecycle from paid commerce payments only", async () => {
    await createPaymentForClient(fixture, {
      paymentScope: PAYMENT_SCOPE.PLATFORM_BILLING,
      status: "captured",
      capturedAt: daysAgo(5),
    });
    await createPaymentForClient(fixture, {
      status: "voided",
      capturedAt: daysAgo(4),
    });
    await createPaymentForClient(fixture, {
      status: "refunded_full",
      capturedAt: daysAgo(3),
    });

    const emptyRefresh = await request(app)
      .post(`/business/clients/${fixture.client._id}/lifecycle/refresh`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(emptyRefresh.status).toBe(200);
    expect(emptyRefresh.body.data.lifecycleStatus).toBe("new");
    expect(emptyRefresh.body.data.firstPaidVisitAt).toBeNull();

    await createPaymentForClient(fixture, {
      status: "captured",
      capturedAt: daysAgo(20),
    });

    const paidRefresh = await request(app)
      .post(`/business/clients/${fixture.client._id}/lifecycle/refresh`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(paidRefresh.status).toBe(200);
    expect(paidRefresh.body.data.lifecycleStatus).toBe("active");
    expect(paidRefresh.body.data.firstPaidVisitAt).toBeTruthy();
    expect(paidRefresh.body.data.lastPaidVisitAt).toBeTruthy();
  });

  test("marks old clients as lost and then won_back after a new paid visit", async () => {
    await createPaymentForClient(fixture, {
      status: "captured",
      capturedAt: daysAgo(130),
    });

    const lostRefresh = await request(app)
      .post(`/business/clients/${fixture.client._id}/lifecycle/refresh`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(lostRefresh.status).toBe(200);
    expect(lostRefresh.body.data.lifecycleStatus).toBe("lost");

    await createPaymentForClient(fixture, {
      status: "captured",
      capturedAt: new Date(),
    });

    const wonBackRefresh = await request(app)
      .post(`/business/clients/${fixture.client._id}/lifecycle/refresh`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(wonBackRefresh.status).toBe(200);
    expect(wonBackRefresh.body.data.lifecycleStatus).toBe("won_back");
    expect(wonBackRefresh.body.data.wonBackAt).toBeTruthy();
  });

  test("payment capture synchronizes first paid visit lifecycle", async () => {
    const checkout = await createClosedCheckoutForFixture(fixture, {
      subtotal: 35,
      discountTotal: 0,
      tip: 5,
      total: 40,
      sourcePrice: 35,
    });

    const res = await request(app)
      .post(`/payment/checkout/${checkout._id}/capture`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        method: "card_manual",
        amount: 40,
      });

    expect(res.status).toBe(201);

    const client = await Client.findById(fixture.client._id);
    expect(client.lifecycleStatus).toBe("active");
    expect(client.firstPaidVisitAt).toBeTruthy();
    expect(client.lastPaidVisitAt).toBeTruthy();
  });

  test("updates consent flags with explicit booleans only", async () => {
    const invalid = await request(app)
      .patch(`/business/clients/${fixture.client._id}/consent`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        consentFlags: {
          marketingEmail: "yes",
        },
      });

    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toContain("must be a boolean value");

    const valid = await request(app)
      .patch(`/business/clients/${fixture.client._id}/consent`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        source: "owner_update",
        consentFlags: {
          marketingEmail: true,
          marketingSms: false,
        },
      });

    expect(valid.status).toBe(200);
    expect(valid.body.data.consentFlags.marketingEmail.granted).toBe(true);
    expect(valid.body.data.consentFlags.marketingSms.granted).toBe(false);

    const client = await Client.findById(fixture.client._id);
    expect(client.consentFlags.marketingEmail.granted).toBe(true);
    expect(client.consentFlags.marketingEmail.grantedAt).toBeTruthy();
    expect(client.consentFlags.marketingSms.revokedAt).toBeTruthy();
  });

  test("rejects lifecycle and consent changes through generic client update", async () => {
    const res = await request(app)
      .put(`/business/clients/${fixture.client._id}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        firstName: "Bypass",
        lifecycleStatus: "lost",
        consentFlags: {
          marketingEmail: { granted: true },
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "Lifecycle and consent fields must be updated through dedicated endpoints."
    );

    const client = await Client.findById(fixture.client._id);
    expect(client.lifecycleStatus).toBe("new");
    expect(client.consentFlags.marketingEmail.granted).toBe(false);
  });

  test("rejects update operators on generic client update", async () => {
    const res = await request(app)
      .put(`/business/clients/${fixture.client._id}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        $set: {
          lifecycleStatus: "lost",
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Update operators are not allowed.");
  });

  test("manual client messages only send through consented marketing channels", async () => {
    const optedIn = await Client.create({
      business: fixture.business._id,
      firstName: "Opted",
      lastName: "In",
      email: "opted-in@example.com",
      phone: "+34666000111",
      isActive: true,
      status: "activated",
      consentFlags: {
        marketingEmail: { granted: true, source: "owner_update" },
        marketingSms: { granted: true, source: "owner_update" },
      },
    });

    const optedOut = await Client.create({
      business: fixture.business._id,
      firstName: "Opted",
      lastName: "Out",
      email: "opted-out@example.com",
      phone: "+34666000222",
      isActive: true,
      status: "activated",
    });

    const res = await request(app)
      .post("/business/clients/messages")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        clientIds: [optedIn._id.toString(), optedOut._id.toString()],
        message: "Promo available this week",
      });

    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalTargets).toBe(2);
    expect(res.body.data.summary.emailSent).toBe(1);
    expect(res.body.data.summary.smsSent).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      "opted-in@example.com",
      expect.any(String),
      "Promo available this week"
    );
    expect(sendSMS).toHaveBeenCalledTimes(1);
    expect(sendSMS).toHaveBeenCalledWith(
      "+34666000111",
      expect.stringContaining("Promo available this week")
    );
  });

  test("message blast recipient groups count only marketing-email consented clients", async () => {
    await Client.create({
      business: fixture.business._id,
      firstName: "Email",
      lastName: "Allowed",
      email: "allowed@example.com",
      phone: "+34666000333",
      isActive: true,
      status: "activated",
      consentFlags: {
        marketingEmail: { granted: true, source: "owner_update" },
      },
    });

    await Client.create({
      business: fixture.business._id,
      firstName: "Email",
      lastName: "Denied",
      email: "denied@example.com",
      phone: "+34666000444",
      isActive: true,
      status: "activated",
    });

    const res = await request(app)
      .get("/business/message-blast/recipient-groups")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    const allGroup = res.body.data.find((group) => group.value === "all");
    const activeGroup = res.body.data.find((group) => group.value === "active");

    expect(allGroup.count).toBe(1);
    expect(activeGroup.count).toBe(1);
  });
});
