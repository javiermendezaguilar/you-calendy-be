const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const Refund = require("../models/refund");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createPaymentCommerceFixture,
  createCapturedPaymentForFixture,
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
    const refundRes = await request(app)
      .post(`/payment/${payment._id}/refund`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 10, reason: "Service issue" });

    expect(refundRes.status).toBe(201);
    expect(refundRes.body.data.amount).toBe(10);
    expect(refundRes.body.data.reason).toBe("Service issue");

    const updatedPayment = await Payment.findById(payment._id).lean();
    expect(updatedPayment.status).toBe("refunded_partial");
    expect(updatedPayment.refundedTotal).toBe(10);

    const updatedCheckout = await Checkout.findById(checkout._id).lean();
    expect(updatedCheckout.refundSummary.refundedTotal).toBe(10);
    expect(updatedCheckout.refundSummary.status).toBe("partial");
  });

  test("captures a full refund and updates appointment payment status", async () => {
    const refundRes = await request(app)
      .post(`/payment/${payment._id}/refund`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 40, reason: "Full refund" });

    expect(refundRes.status).toBe(201);

    const updatedPayment = await Payment.findById(payment._id).lean();
    expect(updatedPayment.status).toBe("refunded_full");
    expect(updatedPayment.refundedTotal).toBe(40);

    const updatedAppointment = await Appointment.findById(
      fixture.appointment._id
    ).lean();
    expect(updatedAppointment.paymentStatus).toBe("Refunded");

    const refunds = await Refund.find({ payment: payment._id }).lean();
    expect(refunds).toHaveLength(1);
  });

  test("rejects refund amounts above the remaining captured total", async () => {
    const firstRefund = await request(app)
      .post(`/payment/${payment._id}/refund`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 15, reason: "Partial refund" });

    expect(firstRefund.status).toBe(201);

    const excessiveRefund = await request(app)
      .post(`/payment/${payment._id}/refund`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 30, reason: "Too much" });

    expect(excessiveRefund.status).toBe(409);
    expect(excessiveRefund.body.message).toMatch(/exceeds/i);
  });
});
