const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const CashSession = require("../models/cashSession");
const Payment = require("../models/payment");
const Refund = require("../models/refund");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createPaymentCommerceFixture,
  openCashSessionForToken,
  captureCheckoutPaymentForToken,
  createCapturedPaymentForFixture,
} = require("./helpers/commerceFixture");

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("Payment void v1", () => {
  let fixture;
  let checkout;
  let token;

  beforeEach(async () => {
    ({ fixture, checkout, token } = await createPaymentCommerceFixture({
      ownerName: "Void Owner",
      ownerEmail: "void-owner@example.com",
      businessName: "Void Shop",
    }));
  });

  test("voids a captured card payment and reopens financial state", async () => {
    const captureRes = await captureCheckoutPaymentForToken(
      app,
      token,
      checkout._id,
      { method: "card_manual", amount: 40, reference: "void-card-001" }
    );

    expect(captureRes.status).toBe(201);

    const voidRes = await request(app)
      .post(`/payment/${captureRes.body.data._id}/void`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Wrong payment method" });

    expect(voidRes.status).toBe(200);
    expect(voidRes.body.data.status).toBe("voided");
    expect(voidRes.body.data.voidReason).toBe("Wrong payment method");
    expect(voidRes.body.data.checkout.status).toBe("closed");

    const updatedAppointment = await Appointment.findById(
      fixture.appointment._id
    ).lean();
    expect(updatedAppointment.paymentStatus).toBe("Pending");
  });

  test("blocks void when the payment already has refunds", async () => {
    const payment = await createCapturedPaymentForFixture(fixture, checkout, {
      amount: 40,
      reference: "void-refund-block",
    });

    await Refund.create({
      payment: payment._id,
      checkout: checkout._id,
      appointment: fixture.appointment._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      amount: 10,
      currency: "EUR",
      reason: "Existing refund",
      refundedAt: new Date(),
      refundedBy: fixture.owner._id,
    });

    payment.refundedTotal = 10;
    payment.status = "refunded_partial";
    await payment.save();

    const voidRes = await request(app)
      .post(`/payment/${payment._id}/void`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Should fail" });

    expect(voidRes.status).toBe(409);
    expect(voidRes.body.message).toMatch(/refunds cannot be voided/i);
  });

  test("blocks a second void on the same checkout after one void correction already happened", async () => {
    const firstCapture = await captureCheckoutPaymentForToken(
      app,
      token,
      checkout._id,
      { method: "card_manual", amount: 40, reference: "void-cycle-first" }
    );

    expect(firstCapture.status).toBe(201);

    const firstVoid = await request(app)
      .post(`/payment/${firstCapture.body.data._id}/void`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "First correction" });

    expect(firstVoid.status).toBe(200);

    const recapture = await captureCheckoutPaymentForToken(
      app,
      token,
      checkout._id,
      { method: "other", amount: 40, reference: "void-cycle-recapture" }
    );

    expect(recapture.status).toBe(201);

    const secondVoid = await request(app)
      .post(`/payment/${recapture.body.data._id}/void`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Second correction should fail" });

    expect(secondVoid.status).toBe(409);
    expect(secondVoid.body.message).toMatch(/void correction cycle/i);

    const recapturedPayment = await Payment.findById(recapture.body.data._id).lean();
    expect(recapturedPayment.status).toBe("captured");
  });

  test("voids a cash payment in an open cash session and recalculates the drawer", async () => {
    const openRes = await openCashSessionForToken(app, token, {
      openingFloat: 50,
      currency: "EUR",
    });
    expect(openRes.status).toBe(201);

    const captureRes = await captureCheckoutPaymentForToken(
      app,
      token,
      checkout._id,
      { method: "cash", amount: 40, reference: "void-cash-001" }
    );

    expect(captureRes.status).toBe(201);

    const voidRes = await request(app)
      .post(`/payment/${captureRes.body.data._id}/void`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Cash capture mistake" });

    expect(voidRes.status).toBe(200);
    expect(voidRes.body.data.status).toBe("voided");

    const cashSession = await CashSession.findById(openRes.body.data._id).lean();
    expect(cashSession.payments).toHaveLength(0);
    expect(cashSession.summary.cashSalesTotal).toBe(0);
    expect(cashSession.summary.transactionCount).toBe(0);
    expect(cashSession.summary.expectedDrawerTotal).toBe(50);
    expect(cashSession.closingExpected).toBe(50);
  });

  test("blocks void for a cash payment when the cash session is already closed", async () => {
    const openRes = await openCashSessionForToken(app, token, {
      openingFloat: 50,
      currency: "EUR",
    });
    expect(openRes.status).toBe(201);

    const captureRes = await captureCheckoutPaymentForToken(
      app,
      token,
      checkout._id,
      { method: "cash", amount: 40, reference: "void-cash-closed" }
    );
    expect(captureRes.status).toBe(201);

    await CashSession.findByIdAndUpdate(openRes.body.data._id, {
      status: "closed",
      closedAt: new Date(),
      closedBy: fixture.owner._id,
    });

    const voidRes = await request(app)
      .post(`/payment/${captureRes.body.data._id}/void`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Should fail because drawer is closed" });

    expect(voidRes.status).toBe(409);
    expect(voidRes.body.message).toMatch(/closed cash session/i);

    const storedPayment = await Payment.findById(captureRes.body.data._id).lean();
    expect(storedPayment.status).toBe("captured");
  });
});
