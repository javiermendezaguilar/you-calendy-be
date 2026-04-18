const request = require("supertest");
const app = require("../app");
const CashSession = require("../models/cashSession");
const Payment = require("../models/payment");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
  createClosedCheckoutForFixture,
  openCashSessionForToken,
  captureCheckoutPaymentForToken,
} = require("./helpers/commerceFixture");

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("CashSession v1", () => {
  let fixture;
  let token;
  let checkout;

  beforeEach(async () => {
    fixture = await createCommerceFixture({
      ownerName: "Cash Owner",
      ownerEmail: "cash-owner@example.com",
      businessName: "Cash Shop",
      appointmentStatus: "Completed",
      promotion: {
        applied: false,
        discountAmount: 0,
        discountPercentage: 0,
        originalPrice: 0,
      },
      flashSale: {
        applied: false,
        discountAmount: 0,
        discountPercentage: 0,
        originalPrice: 0,
      },
    });

    token = fixture.token;
    checkout = await createClosedCheckoutForFixture(fixture, {
      total: 40,
      tip: 5,
      sourcePrice: 35,
    });
  });

  test("opens a cash session, reads the active one, and blocks duplicates", async () => {
    const openRes = await openCashSessionForToken(app, token);

    expect(openRes.status).toBe(201);
    expect(openRes.body.data.status).toBe("open");
    expect(openRes.body.data.openingFloat).toBe(50);

    const activeRes = await request(app)
      .get("/cash-sessions/active")
      .set("Authorization", `Bearer ${token}`);

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data._id).toBe(openRes.body.data._id);

    const duplicateOpen = await openCashSessionForToken(app, token, {
      openingFloat: 20,
    });

    expect(duplicateOpen.status).toBe(409);
    expect(duplicateOpen.body.message).toMatch(/active cash session already exists/i);
  });

  test("associates captured cash payments to the active session", async () => {
    const openRes = await openCashSessionForToken(app, token);

    const captureRes = await captureCheckoutPaymentForToken(app, token, checkout._id, {
      method: "cash",
      amount: 40,
      reference: "cash-register-002",
    });

    expect(captureRes.status).toBe(201);
    expect(captureRes.body.data.cashSession._id).toBe(openRes.body.data._id);

    const storedPayment = await Payment.findById(captureRes.body.data._id).lean();
    expect(storedPayment.cashSession.toString()).toBe(openRes.body.data._id);
  });

  test("closes a cash session and persists summary plus variance", async () => {
    const openRes = await openCashSessionForToken(app, token);

    await captureCheckoutPaymentForToken(app, token, checkout._id, {
      method: "cash",
      amount: 40,
      reference: "cash-register-003",
    });

    const closeRes = await request(app)
      .post(`/cash-sessions/${openRes.body.data._id}/close`)
      .set("Authorization", `Bearer ${token}`)
      .send({ closingDeclared: 90 });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe("closed");
    expect(closeRes.body.data.closingExpected).toBe(90);
    expect(closeRes.body.data.closingDeclared).toBe(90);
    expect(closeRes.body.data.summary.cashSalesTotal).toBe(40);
    expect(closeRes.body.data.summary.tipsTotal).toBe(5);
    expect(closeRes.body.data.summary.transactionCount).toBe(1);
    expect(closeRes.body.data.summary.expectedDrawerTotal).toBe(90);
    expect(closeRes.body.data.variance).toBe(0);
    expect(closeRes.body.data.payments).toHaveLength(1);

    const storedSession = await CashSession.findById(openRes.body.data._id).lean();
    expect(storedSession.status).toBe("closed");
    expect(storedSession.closingExpected).toBe(90);
    expect(storedSession.summary.cashSalesTotal).toBe(40);
    expect(storedSession.summary.tipsTotal).toBe(5);
    expect(storedSession.summary.transactionCount).toBe(1);
    expect(storedSession.summary.expectedDrawerTotal).toBe(90);
    expect(storedSession.variance).toBe(0);

    const duplicateClose = await request(app)
      .post(`/cash-sessions/${openRes.body.data._id}/close`)
      .set("Authorization", `Bearer ${token}`)
      .send({ closingDeclared: 90 });

    expect(duplicateClose.status).toBe(409);
    expect(duplicateClose.body.message).toMatch(/already closed/i);
  });
});
