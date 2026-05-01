const request = require("supertest");
const app = require("../app");
const CashSession = require("../models/cashSession");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createPaymentCommerceFixture,
  createCapturedPaymentForFixture,
  openCashSessionForToken,
  captureCheckoutPaymentForToken,
} = require("./helpers/commerceFixture");

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("Financial reconciliation v1", () => {
  let fixture;
  let checkout;
  let token;

  const getReconciliation = (authToken = token, query = {}) =>
    request(app)
      .get("/payment/reconciliation")
      .set("Authorization", `Bearer ${authToken}`)
      .query(query);

  const expectIssue = (res, issue) => {
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("attention_required");
    expect(res.body.data.issues).toEqual(
      expect.arrayContaining([expect.objectContaining(issue)])
    );
  };

  beforeEach(async () => {
    ({ fixture, checkout, token } = await createPaymentCommerceFixture({
      ownerName: "Reconciliation Owner",
      ownerEmail: "reconciliation-owner@example.com",
      businessName: "Reconciliation Shop",
    }));
  });

  test("requires authentication", async () => {
    const res = await request(app).get("/payment/reconciliation");

    expect(res.status).toBe(401);
  });

  test("returns clean when payment, checkout and cash session are aligned", async () => {
    await createCapturedPaymentForFixture(fixture, checkout, {
      method: "card_manual",
      amount: 40,
      currency: "EUR",
    });

    const res = await getReconciliation();

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("clean");
    expect(res.body.data.moneyScope.domain).toBe("commerce_checkout");
    expect(res.body.data.summary.paymentCount).toBe(1);
    expect(res.body.data.summary.issueCount).toBe(0);
    expect(res.body.data.issues).toEqual([]);
  });

  test("detects payment to checkout amount mismatch without mutating data", async () => {
    const payment = await createCapturedPaymentForFixture(fixture, checkout, {
      method: "card_manual",
      amount: 35,
      currency: "EUR",
    });

    const res = await getReconciliation();

    expectIssue(res, {
      code: "payment_checkout_amount_mismatch",
      severity: "high",
      entityType: "payment",
      entityId: payment._id.toString(),
      context: expect.objectContaining({
        paymentAmount: 35,
        checkoutAmountDue: 40,
      }),
    });

    const storedPayment = await Payment.findById(payment._id).lean();
    const storedCheckout = await Checkout.findById(checkout._id).lean();
    expect(storedPayment.amount).toBe(35);
    expect(storedCheckout.status).toBe("paid");
  });

  test("detects paid checkout without retained commerce payment", async () => {
    checkout.status = "paid";
    await checkout.save();

    const res = await getReconciliation();

    expectIssue(res, {
      code: "paid_checkout_missing_retained_payment",
      severity: "high",
      entityType: "checkout",
      entityId: checkout._id.toString(),
    });
  });

  test("does not flag a paid checkout when its retained payment is outside the payment date range", async () => {
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await createCapturedPaymentForFixture(fixture, checkout, {
      method: "card_manual",
      amount: 40,
      currency: "EUR",
      capturedAt: lastWeek,
    });

    const res = await getReconciliation(token, {
      startDate: yesterday.toISOString(),
      endDate: tomorrow.toISOString(),
    });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("clean");
    expect(res.body.data.summary.paymentCount).toBe(0);
    expect(res.body.data.summary.checkoutCount).toBe(1);
    expect(res.body.data.summary.issueCount).toBe(0);
  });

  test("detects retained cash payment without cash session", async () => {
    const payment = await createCapturedPaymentForFixture(fixture, checkout, {
      method: "cash",
      amount: 40,
      currency: "EUR",
    });

    const res = await getReconciliation();

    expectIssue(res, {
      code: "cash_payment_missing_cash_session",
      severity: "high",
      entityId: payment._id.toString(),
    });
  });

  test("detects closed cash session summary mismatch", async () => {
    const openRes = await openCashSessionForToken(app, token, {
      openingFloat: 50,
    });
    expect(openRes.status).toBe(201);

    const captureRes = await captureCheckoutPaymentForToken(
      app,
      token,
      checkout._id,
      {
        method: "cash",
        amount: 40,
        reference: "reconcile-cash",
      }
    );
    expect(captureRes.status).toBe(201);

    const closeRes = await request(app)
      .post(`/cash-sessions/${openRes.body.data._id}/close`)
      .set("Authorization", `Bearer ${token}`)
      .send({ closingDeclared: 90 });
    expect(closeRes.status).toBe(200);

    await CashSession.findByIdAndUpdate(openRes.body.data._id, {
      "summary.cashSalesTotal": 10,
      closingExpected: 60,
    });

    const res = await getReconciliation();

    expectIssue(res, {
      code: "cash_session_summary_mismatch",
      severity: "medium",
      entityType: "cash_session",
      entityId: openRes.body.data._id,
      context: expect.objectContaining({
        field: "summary.cashSalesTotal",
        storedValue: 10,
        expectedValue: 40,
      }),
    });
    expectIssue(res, {
      code: "cash_session_summary_mismatch",
      severity: "medium",
      entityType: "cash_session",
      entityId: openRes.body.data._id,
      context: expect.objectContaining({
        field: "closingExpected",
        storedValue: 60,
        expectedValue: 90,
      }),
    });
  });

  test("rejects invalid date filters", async () => {
    const res = await getReconciliation(token, { startDate: "not-a-date" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/startDate/i);
  });

  test("rejects periods with startDate after endDate", async () => {
    const res = await getReconciliation(token, {
      startDate: "2026-04-20",
      endDate: "2026-04-19",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/before or equal to endDate/i);
  });
});
