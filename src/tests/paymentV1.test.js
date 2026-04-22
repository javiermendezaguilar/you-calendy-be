const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const Payment = require("../models/payment");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createPaymentCommerceFixture,
  openCashSessionForToken,
  captureCheckoutPaymentForToken,
} = require("./helpers/commerceFixture");

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("Payment v1", () => {
  let fixture;
  let appointment;
  let checkout;
  let token;

  beforeEach(async () => {
    ({ fixture, appointment, checkout, token } =
      await createPaymentCommerceFixture({
      ownerName: "Payment Owner",
      ownerEmail: "payment-owner@example.com",
      businessName: "Payment Shop",
    }));
  });

  test("captures a payment from a closed checkout and updates legacy appointment payment status", async () => {
    await openCashSessionForToken(app, token);

    const captureRes = await captureCheckoutPaymentForToken(
      app,
      token,
      checkout._id,
      {
        method: "cash",
        amount: 40,
        reference: "cash-register-001",
      }
    );

    expect(captureRes.status).toBe(201);
    expect(captureRes.body.data.status).toBe("captured");
    expect(captureRes.body.data.method).toBe("cash");
    expect(captureRes.body.data.amount).toBe(40);
    expect(captureRes.body.data.tip).toBe(5);
    expect(captureRes.body.data.checkout.status).toBe("paid");

    const updatedAppointment = await Appointment.findById(appointment._id).lean();
    expect(updatedAppointment.paymentStatus).toBe("Paid");

    const storedPayment = await Payment.findOne({
      checkout: checkout._id,
    }).lean();
    expect(storedPayment).not.toBeNull();
    expect(storedPayment.paymentScope).toBe("commerce_checkout");
    expect(storedPayment.snapshot.total).toBe(40);
    expect(storedPayment.snapshot.service.name).toBe("Signature Cut");
  });

  test("rejects cash payments when there is no active cash session", async () => {
    const captureRes = await captureCheckoutPaymentForToken(
      app,
      token,
      checkout._id,
      {
        method: "cash",
        amount: 40,
        reference: "cash-register-missing-session",
      }
    );

    expect(captureRes.status).toBe(409);
    expect(captureRes.body.message).toMatch(/active cash session is required/i);
  });

  test("rejects duplicate captured payments for the same checkout", async () => {
    const firstCapture = await request(app)
      .post(`/payment/checkout/${checkout._id}/capture`)
      .set("Authorization", `Bearer ${token}`)
      .send({ method: "card_manual", amount: 40 });

    expect(firstCapture.status).toBe(201);

    const duplicateCapture = await request(app)
      .post(`/payment/checkout/${checkout._id}/capture`)
      .set("Authorization", `Bearer ${token}`)
      .send({ method: "cash", amount: 40 });

    expect(duplicateCapture.status).toBe(409);
    expect(duplicateCapture.body.message).toMatch(/captured payment already exists/i);
  });

  test("reads payment by checkout and by id", async () => {
    await openCashSessionForToken(app, token);

    const captureRes = await captureCheckoutPaymentForToken(
      app,
      token,
      checkout._id,
      { method: "other", amount: 40, reference: "terminal-xyz" }
    );

    const paymentId = captureRes.body.data._id;

    const byCheckoutRes = await request(app)
      .get(`/payment/checkout/${checkout._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(byCheckoutRes.status).toBe(200);
    expect(byCheckoutRes.body.data._id).toBe(paymentId);

    const byIdRes = await request(app)
      .get(`/payment/${paymentId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(byIdRes.status).toBe(200);
    expect(byIdRes.body.data.reference).toBe("terminal-xyz");
    expect(byIdRes.body.data.capturedBy.email).toBe("payment-owner@example.com");
  });
});
