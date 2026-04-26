const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const CashSession = require("../models/cashSession");
const Payment = require("../models/payment");
const User = require("../models/User/user");
const Business = require("../models/User/business");
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
  let foreignOwnerToken;

  const getActiveCashSessionForToken = (authToken = token, query = {}) =>
    request(app)
      .get("/cash-sessions/active")
      .set("Authorization", `Bearer ${authToken}`)
      .query(query);

  const closeCashSessionForToken = (
    sessionId,
    payload,
    authToken = token
  ) =>
    request(app)
      .post(`/cash-sessions/${sessionId}/close`)
      .set("Authorization", `Bearer ${authToken}`)
      .send(payload);

  const openCaptureAndCloseCashSession = async ({
    openingFloat = 50,
    amount = 40,
    reference,
    closingDeclared,
    closingNote,
    checkoutId = checkout._id,
  }) => {
    const openRes = await openCashSessionForToken(app, token, {
      openingFloat,
    });

    await captureCheckoutPaymentForToken(app, token, checkoutId, {
      method: "cash",
      amount,
      reference,
    });

    const closePayload = { closingDeclared };
    if (closingNote) {
      closePayload.closingNote = closingNote;
    }

    const closeRes = await closeCashSessionForToken(
      openRes.body.data._id,
      closePayload
    );

    return { openRes, closeRes };
  };

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

    const foreignOwner = await User.create({
      name: "Foreign Cash Owner",
      email: "foreign-cash-owner@example.com",
      password: "password123",
      role: "barber",
      isActive: true,
    });

    await Business.create({
      owner: foreignOwner._id,
      name: "Foreign Cash Shop",
      contactInfo: { phone: "+34999999999" },
      bookingBuffer: 30,
      penaltySettings: {
        noShowPenalty: false,
        noShowPenaltyAmount: 0,
      },
    });

    foreignOwnerToken = jwt.sign(
      { id: foreignOwner._id, role: "barber" },
      process.env.JWT_SECRET
    );
  });

  test("opens a cash session, reads the active one, and blocks duplicates", async () => {
    const openRes = await openCashSessionForToken(app, token);

    expect(openRes.status).toBe(201);
    expect(openRes.body.data.status).toBe("open");
    expect(openRes.body.data.openingFloat).toBe(50);
    expect(openRes.body.data.openingReason).toBe("manual_start");

    const activeRes = await getActiveCashSessionForToken();

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data._id).toBe(openRes.body.data._id);
    expect(activeRes.body.data.opening.source).toBe("manual");
    expect(activeRes.body.data.opening.reason).toBe("manual_start");
    expect(activeRes.body.data.opening.note).toBe("");
    expect(activeRes.body.data.opening.float).toBe(50);

    const duplicateOpen = await openCashSessionForToken(app, token, {
      openingFloat: 20,
    });

    expect(duplicateOpen.status).toBe(409);
    expect(duplicateOpen.body.message).toMatch(/active cash session already exists/i);
  });

  test("reopens cash session through handoff when opening float matches the previous closing declared amount", async () => {
    const firstOpenRes = await openCashSessionForToken(app, token, {
      openingFloat: 50,
    });

    await captureCheckoutPaymentForToken(app, token, checkout._id, {
      method: "cash",
      amount: 40,
      reference: "cash-register-001-handoff",
    });

    const firstCloseRes = await closeCashSessionForToken(
      firstOpenRes.body.data._id,
      { closingDeclared: 90 }
    );

    expect(firstCloseRes.status).toBe(200);

    const secondOpenRes = await request(app)
      .post("/cash-sessions/open")
      .set("Authorization", `Bearer ${token}`)
      .send({
        openingFloat: 90,
        currency: "EUR",
        handoffFromSessionId: firstOpenRes.body.data._id,
      });

    expect(secondOpenRes.status).toBe(201);
    expect(secondOpenRes.body.data.openingSource).toBe("handoff");
    expect(secondOpenRes.body.data.openingReason).toBe("handoff");
    expect(secondOpenRes.body.data.handoffFrom._id).toBe(firstOpenRes.body.data._id);
    expect(secondOpenRes.body.data.handoffFrom.closingDeclared).toBe(90);

    const activeRes = await getActiveCashSessionForToken();

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data.opening.source).toBe("handoff");
    expect(activeRes.body.data.opening.reason).toBe("handoff");
    expect(activeRes.body.data.opening.float).toBe(90);
    expect(activeRes.body.data.opening.handoffFrom._id).toBe(
      firstOpenRes.body.data._id
    );
    expect(activeRes.body.data.opening.handoffFrom.closingDeclared).toBe(90);
  });

  test("rejects cash session handoff when opening float does not match previous closing declared amount", async () => {
    const firstOpenRes = await openCashSessionForToken(app, token, {
      openingFloat: 50,
    });

    await captureCheckoutPaymentForToken(app, token, checkout._id, {
      method: "cash",
      amount: 40,
      reference: "cash-register-001-handoff-mismatch",
    });

    const firstCloseRes = await closeCashSessionForToken(
      firstOpenRes.body.data._id,
      { closingDeclared: 90 }
    );

    expect(firstCloseRes.status).toBe(200);

    const secondOpenRes = await request(app)
      .post("/cash-sessions/open")
      .set("Authorization", `Bearer ${token}`)
      .send({
        openingFloat: 80,
        currency: "EUR",
        handoffFromSessionId: firstOpenRes.body.data._id,
      });

    expect(secondOpenRes.status).toBe(409);
    expect(secondOpenRes.body.message).toMatch(/openingFloat must match/i);
  });

  test("rejects cash session handoff when handoffFromSessionId is not a valid object id", async () => {
    const openRes = await request(app)
      .post("/cash-sessions/open")
      .set("Authorization", `Bearer ${token}`)
      .send({
        openingFloat: 50,
        currency: "EUR",
        handoffFromSessionId: "not-a-valid-id",
      });

    expect(openRes.status).toBe(400);
    expect(openRes.body.message).toMatch(/handoffFromSessionId must be a valid/i);
  });

  test("requires an opening note for manual cash session adjustment", async () => {
    const openWithoutNoteRes = await request(app)
      .post("/cash-sessions/open")
      .set("Authorization", `Bearer ${token}`)
      .send({
        openingFloat: 65,
        currency: "EUR",
        openingReason: "manual_adjustment",
      });

    expect(openWithoutNoteRes.status).toBe(400);
    expect(openWithoutNoteRes.body.message).toMatch(/openingNote is required/i);

    const openWithNoteRes = await request(app)
      .post("/cash-sessions/open")
      .set("Authorization", `Bearer ${token}`)
      .send({
        openingFloat: 65,
        currency: "EUR",
        openingReason: "manual_adjustment",
        openingNote: "Adjusted drawer after manual recount before opening",
      });

    expect(openWithNoteRes.status).toBe(201);
    expect(openWithNoteRes.body.data.openingSource).toBe("manual");
    expect(openWithNoteRes.body.data.openingReason).toBe("manual_adjustment");
    expect(openWithNoteRes.body.data.openingNote).toBe(
      "Adjusted drawer after manual recount before opening"
    );

    const activeRes = await getActiveCashSessionForToken();

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data.opening.source).toBe("manual");
    expect(activeRes.body.data.opening.reason).toBe("manual_adjustment");
    expect(activeRes.body.data.opening.note).toBe(
      "Adjusted drawer after manual recount before opening"
    );
    expect(activeRes.body.data.opening.handoffFrom).toBeNull();
  });

  test("returns variance preview for the active cash session without mutating the session", async () => {
    const openRes = await openCashSessionForToken(app, token, {
      openingFloat: 50,
    });

    await captureCheckoutPaymentForToken(app, token, checkout._id, {
      method: "cash",
      amount: 40,
      reference: "cash-register-007",
    });

    const activeRes = await getActiveCashSessionForToken(token, {
      closingDeclaredPreview: 85,
    });

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data.closing.expectedDrawerTotal).toBe(90);
    expect(activeRes.body.data.variancePreview).toEqual({
      closingDeclared: 85,
      variance: -5,
      varianceStatus: "short",
    });

    const storedSession = await CashSession.findById(openRes.body.data._id).lean();
    expect(storedSession.status).toBe("open");
    expect(storedSession.closingDeclared).toBe(0);
    expect(storedSession.variance).toBe(0);
    expect(storedSession.varianceStatus).toBe("exact");
  });

  test("returns live closing readiness for an open cash session after a partial refund", async () => {
    await openCashSessionForToken(app, token);

    const captureRes = await captureCheckoutPaymentForToken(app, token, checkout._id, {
      method: "cash",
      amount: 40,
      reference: "cash-register-002a",
    });

    const refundRes = await request(app)
      .post(`/payment/${captureRes.body.data._id}/refund`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: 10,
        reason: "cash correction",
      });

    expect(refundRes.status).toBe(201);

    const activeRes = await getActiveCashSessionForToken();

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data.summary.cashSalesTotal).toBe(30);
    expect(activeRes.body.data.summary.expectedDrawerTotal).toBe(80);
    expect(activeRes.body.data.closingExpected).toBe(80);
    expect(activeRes.body.data.closing.ready).toBe(true);
    expect(activeRes.body.data.closing.transactionCount).toBe(1);
    expect(activeRes.body.data.closing.cashSalesTotal).toBe(30);
    expect(activeRes.body.data.closing.expectedDrawerTotal).toBe(80);
    expect(activeRes.body.data.payments).toHaveLength(1);
    expect(activeRes.body.data.payments[0].status).toBe("refunded_partial");
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

  test("closes a cash session using net retained cash after a partial refund", async () => {
    const openRes = await openCashSessionForToken(app, token);

    const captureRes = await captureCheckoutPaymentForToken(app, token, checkout._id, {
      method: "cash",
      amount: 40,
      reference: "cash-register-002b",
    });

    const refundRes = await request(app)
      .post(`/payment/${captureRes.body.data._id}/refund`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: 10,
        reason: "cash correction",
      });

    expect(refundRes.status).toBe(201);

    const closeRes = await closeCashSessionForToken(openRes.body.data._id, {
      closingDeclared: 80,
    });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.closingExpected).toBe(80);
    expect(closeRes.body.data.summary.cashSalesTotal).toBe(30);
    expect(closeRes.body.data.summary.transactionCount).toBe(1);
    expect(closeRes.body.data.summary.expectedDrawerTotal).toBe(80);
    expect(closeRes.body.data.variance).toBe(0);
    expect(closeRes.body.data.payments).toHaveLength(1);

    const storedSession = await CashSession.findById(openRes.body.data._id).lean();
    expect(storedSession.closingExpected).toBe(80);
    expect(storedSession.summary.cashSalesTotal).toBe(30);
    expect(storedSession.summary.transactionCount).toBe(1);
    expect(storedSession.summary.expectedDrawerTotal).toBe(80);
  });

  test("closes a cash session and persists summary plus variance", async () => {
    const openRes = await openCashSessionForToken(app, token);

    await captureCheckoutPaymentForToken(app, token, checkout._id, {
      method: "cash",
      amount: 40,
      reference: "cash-register-003",
    });

    const closeRes = await closeCashSessionForToken(openRes.body.data._id, {
      closingDeclared: 90,
    });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe("closed");
    expect(closeRes.body.data.closingExpected).toBe(90);
    expect(closeRes.body.data.closingDeclared).toBe(90);
    expect(closeRes.body.data.summary.cashSalesTotal).toBe(40);
    expect(closeRes.body.data.summary.tipsTotal).toBe(5);
    expect(closeRes.body.data.summary.transactionCount).toBe(1);
    expect(closeRes.body.data.summary.expectedDrawerTotal).toBe(90);
    expect(closeRes.body.data.closing.ready).toBe(true);
    expect(closeRes.body.data.closing.transactionCount).toBe(1);
    expect(closeRes.body.data.closing.cashSalesTotal).toBe(40);
    expect(closeRes.body.data.closing.expectedDrawerTotal).toBe(90);
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

    const duplicateClose = await closeCashSessionForToken(openRes.body.data._id, {
      closingDeclared: 90,
    });

    expect(duplicateClose.status).toBe(409);
    expect(duplicateClose.body.message).toMatch(/already closed/i);
  });

  test("allows only one successful close when the same cash session is closed concurrently", async () => {
    const openRes = await openCashSessionForToken(app, token);

    await captureCheckoutPaymentForToken(app, token, checkout._id, {
      method: "cash",
      amount: 40,
      reference: "cash-register-concurrent-close",
    });

    const closeRequests = await Promise.all([
      closeCashSessionForToken(openRes.body.data._id, {
        closingDeclared: 90,
      }),
      closeCashSessionForToken(openRes.body.data._id, {
        closingDeclared: 95,
        closingNote: "Concurrent recount correction",
      }),
    ]);

    const successResponses = closeRequests.filter((res) => res.status === 200);
    const conflictResponses = closeRequests.filter((res) => res.status === 409);

    expect(successResponses).toHaveLength(1);
    expect(conflictResponses).toHaveLength(1);
    expect(conflictResponses[0].body.message).toMatch(/already closed/i);

    const storedSession = await CashSession.findById(openRes.body.data._id).lean();
    expect(storedSession.status).toBe("closed");
    expect(storedSession.closingDeclared).toBe(
      successResponses[0].body.data.closingDeclared
    );
    expect(storedSession.variance).toBe(successResponses[0].body.data.variance);
    expect(storedSession.summary.expectedDrawerTotal).toBe(90);
  });

  test("requires a closing note when the drawer variance is not exact", async () => {
    const openRes = await openCashSessionForToken(app, token);

    await captureCheckoutPaymentForToken(app, token, checkout._id, {
      method: "cash",
      amount: 40,
      reference: "cash-register-006",
    });

    const closeWithoutNoteRes = await closeCashSessionForToken(
      openRes.body.data._id,
      { closingDeclared: 95 }
    );

    expect(closeWithoutNoteRes.status).toBe(400);
    expect(closeWithoutNoteRes.body.message).toMatch(/closingNote is required/i);

    const closeWithNoteRes = await closeCashSessionForToken(
      openRes.body.data._id,
      {
        closingDeclared: 95,
        closingNote: "Counted extra cash from prior shift adjustment",
      }
    );

    expect(closeWithNoteRes.status).toBe(200);
    expect(closeWithNoteRes.body.data.variance).toBe(5);
    expect(closeWithNoteRes.body.data.varianceStatus).toBe("over");
    expect(closeWithNoteRes.body.data.closingNote).toBe(
      "Counted extra cash from prior shift adjustment"
    );

    const storedSession = await CashSession.findById(openRes.body.data._id).lean();
    expect(storedSession.variance).toBe(5);
    expect(storedSession.varianceStatus).toBe("over");
    expect(storedSession.closingNote).toBe(
      "Counted extra cash from prior shift adjustment"
    );
  });

  test("lists recent cash sessions with status filter and operational closing summary", async () => {
    const { openRes: firstOpenRes, closeRes: firstCloseRes } =
      await openCaptureAndCloseCashSession({
        openingFloat: 50,
        amount: 40,
        reference: "cash-register-004",
        closingDeclared: 90,
      });

    expect(firstCloseRes.status).toBe(200);

    const secondCheckout = await createClosedCheckoutForFixture(fixture, {
      total: 25,
      tip: 0,
      sourcePrice: 25,
    });

    const { openRes: secondOpenRes, closeRes: secondCloseRes } =
      await openCaptureAndCloseCashSession({
        openingFloat: 30,
        amount: 25,
        reference: "cash-register-005",
        closingDeclared: 55,
        checkoutId: secondCheckout._id,
      });

    expect(secondCloseRes.status).toBe(200);

    const listRes = await request(app)
      .get("/cash-sessions")
      .set("Authorization", `Bearer ${token}`)
      .query({
        status: "closed",
        limit: 1,
      });

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0]._id).toBe(secondOpenRes.body.data._id);
    expect(listRes.body.data[0].status).toBe("closed");
    expect(listRes.body.data[0].summary.cashSalesTotal).toBe(25);
    expect(listRes.body.data[0].summary.expectedDrawerTotal).toBe(55);
    expect(listRes.body.data[0].closing.ready).toBe(true);
    expect(listRes.body.data[0].closing.transactionCount).toBe(1);
    expect(listRes.body.data[0].closing.cashSalesTotal).toBe(25);
    expect(listRes.body.data[0].closing.expectedDrawerTotal).toBe(55);
  });

  test("returns a business-scoped cash session report with variance totals", async () => {
    const first = await openCaptureAndCloseCashSession({
      openingFloat: 50,
      amount: 40,
      reference: "cash-register-report-001",
      closingDeclared: 90,
    });

    expect(first.closeRes.status).toBe(200);

    const secondCheckout = await createClosedCheckoutForFixture(fixture, {
      total: 25,
      tip: 0,
      sourcePrice: 25,
    });

    const second = await openCaptureAndCloseCashSession({
      openingFloat: 30,
      amount: 25,
      reference: "cash-register-report-002",
      closingDeclared: 60,
      closingNote: "Over by five after drawer recount",
      checkoutId: secondCheckout._id,
    });

    expect(second.closeRes.status).toBe(200);

    await openCashSessionForToken(app, token, {
      openingFloat: 10,
    });

    const reportRes = await request(app)
      .get("/cash-sessions/report")
      .set("Authorization", `Bearer ${token}`)
      .query({ status: "closed" });

    expect(reportRes.status).toBe(200);
    expect(reportRes.body.data.status).toBe("closed");
    expect(reportRes.body.data.period.dateField).toBe("closedAt");
    expect(reportRes.body.data.totals).toMatchObject({
      sessionCount: 2,
      openCount: 0,
      closedCount: 2,
      transactionCount: 2,
      cashSalesTotal: 65,
      tipsTotal: 5,
      expectedDrawerTotal: 145,
      closingDeclaredTotal: 150,
      varianceTotal: 5,
      varianceBreakdown: {
        exact: 1,
        over: 1,
        short: 0,
      },
    });

    const foreignReportRes = await request(app)
      .get("/cash-sessions/report")
      .set("Authorization", `Bearer ${foreignOwnerToken}`)
      .query({ status: "closed" });

    expect(foreignReportRes.status).toBe(200);
    expect(foreignReportRes.body.data.totals.sessionCount).toBe(0);
    expect(foreignReportRes.body.data.totals.cashSalesTotal).toBe(0);
  });

  test("rejects a foreign business owner listing, reading and closing another business cash session", async () => {
    const openRes = await openCashSessionForToken(app, token, {
      openingFloat: 50,
    });

    expect(openRes.status).toBe(201);

    const listRes = await request(app)
      .get("/cash-sessions")
      .set("Authorization", `Bearer ${foreignOwnerToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(0);

    const getRes = await request(app)
      .get(`/cash-sessions/${openRes.body.data._id}`)
      .set("Authorization", `Bearer ${foreignOwnerToken}`);

    expect(getRes.status).toBe(404);
    expect(getRes.body.message).toMatch(/cash session not found/i);

    const closeRes = await closeCashSessionForToken(
      openRes.body.data._id,
      { closingDeclared: 50 },
      foreignOwnerToken
    );

    expect(closeRes.status).toBe(404);
    expect(closeRes.body.message).toMatch(/cash session not found/i);
  });
});
