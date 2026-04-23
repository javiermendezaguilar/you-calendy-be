const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const CashSession = require("../models/cashSession");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const Refund = require("../models/refund");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createPaymentCommerceFixture,
  createCapturedPaymentForFixture,
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

describe("Payment refunds v1", () => {
  let fixture;
  let checkout;
  let payment;
  let token;

  const refundCapturedPayment = (amount, reason = "") =>
    request(app)
      .post(`/payment/${payment._id}/refund`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount, reason });

  const recaptureCheckout = (payload = {}) =>
    request(app)
      .post(`/payment/checkout/${checkout._id}/capture`)
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

  beforeEach(async () => {
    ({ fixture, checkout, token } = await createPaymentCommerceFixture({
      ownerName: "Refund Owner",
      ownerEmail: "refund-owner@example.com",
      businessName: "Refund Shop",
      paymentStatus: "Paid",
    }));

    payment = await createCapturedPaymentForFixture(fixture, checkout, {
      reference: "refund-seed-payment",
    });
  });

  test("captures a partial refund and updates payment plus checkout summary", async () => {
    const refundRes = await refundCapturedPayment(10, "Service issue");

    expect(refundRes.status).toBe(201);
    expect(refundRes.body.data.amount).toBe(10);
    expect(refundRes.body.data.reason).toBe("Service issue");

    const updatedPayment = await Payment.findById(payment._id).lean();
    expect(updatedPayment.status).toBe("refunded_partial");
    expect(updatedPayment.refundedTotal).toBe(10);

    const updatedCheckout = await Checkout.findById(checkout._id).lean();
    expect(updatedCheckout.refundSummary.refundedTotal).toBe(10);
    expect(updatedCheckout.refundSummary.status).toBe("partial");

    const updatedAppointment = await Appointment.findById(
      fixture.appointment._id
    ).lean();
    expect(updatedAppointment.paymentStatus).toBe("Partially Refunded");
  });

  test("captures a full refund and updates appointment payment status", async () => {
    const refundRes = await refundCapturedPayment(40, "Full refund");

    expect(refundRes.status).toBe(201);

    const updatedPayment = await Payment.findById(payment._id).lean();
    expect(updatedPayment.status).toBe("refunded_full");
    expect(updatedPayment.refundedTotal).toBe(40);

    const updatedAppointment = await Appointment.findById(
      fixture.appointment._id
    ).lean();
    expect(updatedAppointment.paymentStatus).toBe("Refunded");

    const updatedCheckout = await Checkout.findById(checkout._id).lean();
    expect(updatedCheckout.status).toBe("closed");
    expect(updatedCheckout.refundSummary.status).toBe("full");

    const refunds = await Refund.find({ payment: payment._id }).lean();
    expect(refunds).toHaveLength(1);
  });

  test("blocks recapturing a checkout after a full refund", async () => {
    const refundRes = await refundCapturedPayment(40, "Full refund");

    expect(refundRes.status).toBe(201);

    const recaptureRes = await recaptureCheckout({
      method: "card_manual",
      amount: 40,
      reference: "refund-full-recapture",
    });

    expect(recaptureRes.status).toBe(409);
    expect(recaptureRes.body.message).toMatch(/terminal payment already exists/i);
  });

  test("rejects refund amounts above the remaining captured total", async () => {
    const firstRefund = await refundCapturedPayment(15, "Partial refund");

    expect(firstRefund.status).toBe(201);

    const excessiveRefund = await refundCapturedPayment(30, "Too much");

    expect(excessiveRefund.status).toBe(409);
    expect(excessiveRefund.body.message).toMatch(/exceeds/i);
  });

  test("recalculates an open cash session after a partial cash refund", async () => {
    const cashCheckout = await createClosedCheckoutForFixture(fixture, {
      total: 40,
      tip: 5,
      sourcePrice: 35,
    });

    const openRes = await openCashSessionForToken(app, token, {
      openingFloat: 50,
      currency: "EUR",
    });
    expect(openRes.status).toBe(201);

    const cashCaptureRes = await captureCheckoutPaymentForToken(
      app,
      token,
      cashCheckout._id,
      { method: "cash", amount: 40, reference: "refund-cash-001" }
    );
    expect(cashCaptureRes.status).toBe(201);

    const refundRes = await request(app)
      .post(`/payment/${cashCaptureRes.body.data._id}/refund`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 10, reason: "Cash correction" });

    expect(refundRes.status).toBe(201);

    const cashSession = await CashSession.findById(openRes.body.data._id).lean();
    expect(cashSession.summary.cashSalesTotal).toBe(30);
    expect(cashSession.summary.expectedDrawerTotal).toBe(80);
    expect(cashSession.closingExpected).toBe(80);
    expect(cashSession.summary.transactionCount).toBe(1);
    expect(cashSession.payments).toHaveLength(1);
  });

  test("blocks cash refunds when the associated cash session is already closed", async () => {
    const cashCheckout = await createClosedCheckoutForFixture(fixture, {
      total: 40,
      tip: 5,
      sourcePrice: 35,
    });

    const openRes = await openCashSessionForToken(app, token, {
      openingFloat: 50,
      currency: "EUR",
    });
    expect(openRes.status).toBe(201);

    const cashCaptureRes = await captureCheckoutPaymentForToken(
      app,
      token,
      cashCheckout._id,
      { method: "cash", amount: 40, reference: "refund-cash-closed" }
    );
    expect(cashCaptureRes.status).toBe(201);

    await CashSession.findByIdAndUpdate(openRes.body.data._id, {
      status: "closed",
      closedAt: new Date(),
      closedBy: fixture.owner._id,
      closingDeclared: 90,
      closingExpected: 90,
      summary: {
        cashSalesTotal: 40,
        tipsTotal: 0,
        transactionCount: 1,
        expectedDrawerTotal: 90,
      },
      variance: 0,
    });

    const refundRes = await request(app)
      .post(`/payment/${cashCaptureRes.body.data._id}/refund`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 10, reason: "Too late" });

    expect(refundRes.status).toBe(409);
    expect(refundRes.body.message).toMatch(/closed cash session/i);

    const storedSession = await CashSession.findById(openRes.body.data._id).lean();
    expect(storedSession.status).toBe("closed");
    expect(storedSession.summary.cashSalesTotal).toBe(40);
    expect(storedSession.summary.expectedDrawerTotal).toBe(90);

    const storedPayment = await Payment.findById(cashCaptureRes.body.data._id).lean();
    expect(storedPayment.status).toBe("captured");
    expect(storedPayment.refundedTotal).toBe(0);
  });
});
