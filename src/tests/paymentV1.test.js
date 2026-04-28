const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const Payment = require("../models/payment");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCompletedNoDiscountCommerceFixture,
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

  const captureCheckout = (payload = {}) =>
    captureCheckoutPaymentForToken(app, token, checkout._id, payload);

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

  test("freezes checkout totalization in payment snapshot", async () => {
    const customFixture = await createCompletedNoDiscountCommerceFixture({
      ownerName: "Payment Total Owner",
      ownerEmail: "payment-total-owner@example.com",
      businessName: "Payment Total Shop",
    });

    const openRes = await request(app)
      .post(`/checkout/appointment/${customFixture.appointment._id}/open`)
      .set("Authorization", `Bearer ${customFixture.token}`);

    const closeRes = await request(app)
      .post(`/checkout/${openRes.body.data._id}/close`)
      .set("Authorization", `Bearer ${customFixture.token}`)
      .send({
        tip: 3,
        productLines: [{ name: "Pomade", quantity: 2, unitPrice: 6 }],
        discountLines: [{ label: "Loyalty", amount: 5 }],
        taxLines: [{ label: "VAT", source: "vat", rate: 10 }],
      });

    expect(closeRes.status).toBe(200);

    const captureRes = await request(app)
      .post(`/payment/checkout/${closeRes.body.data._id}/capture`)
      .set("Authorization", `Bearer ${customFixture.token}`)
      .send({
        method: "card_manual",
        amount: 65.7,
      });

    expect(captureRes.status).toBe(201);
    expect(captureRes.body.data.amount).toBe(65.7);
    expect(captureRes.body.data.snapshot.totalization).toMatchObject({
      serviceSubtotal: 50,
      productSubtotal: 12,
      subtotal: 62,
      discountTotal: 5,
      taxableSubtotal: 57,
      taxTotal: 5.7,
      tipTotal: 3,
      amountDue: 65.7,
    });
    expect(captureRes.body.data.snapshot.productLines[0].name).toBe("Pomade");
    expect(captureRes.body.data.snapshot.taxLines[0].amount).toBe(5.7);
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
    const firstCapture = await captureCheckout({
      method: "card_manual",
      amount: 40,
    });

    expect(firstCapture.status).toBe(201);

    const duplicateCapture = await request(app)
      .post(`/payment/checkout/${checkout._id}/capture`)
      .set("Authorization", `Bearer ${token}`)
      .send({ method: "cash", amount: 40 });

    expect(duplicateCapture.status).toBe(409);
    expect(duplicateCapture.body.message).toMatch(/terminal payment already exists/i);
  });

  test("allows recapturing the same checkout after a payment was voided", async () => {
    const firstCapture = await captureCheckout({
      method: "card_manual",
      amount: 40,
      reference: "void-then-recapture",
    });

    expect(firstCapture.status).toBe(201);

    const voidRes = await request(app)
      .post(`/payment/${firstCapture.body.data._id}/void`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Wrong method" });

    expect(voidRes.status).toBe(200);

    const recapture = await captureCheckout({
      method: "other",
      amount: 40,
      reference: "void-recapture-ok",
    });

    expect(recapture.status).toBe(201);
    expect(recapture.body.data.status).toBe("captured");
    expect(recapture.body.data.reference).toBe("void-recapture-ok");
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
