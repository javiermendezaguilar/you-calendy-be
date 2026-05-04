const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User/user");
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

describe("Commerce permissions v2", () => {
  let token;
  let foreignBarberToken;
  let staffToken;
  let checkout;
  let payment;
  let fixture;

  beforeEach(async () => {
    const commerceFixture = await createPaymentCommerceFixture();
    fixture = commerceFixture.fixture;
    checkout = commerceFixture.checkout;
    token = commerceFixture.token;

    const foreignBarber = await User.create({
      name: "Foreign Commerce Barber",
      email: "foreign-commerce-barber@example.com",
      password: "password123",
      role: "barber",
      isActive: true,
    });

    foreignBarberToken = jwt.sign(
      { id: foreignBarber._id, role: "barber" },
      process.env.JWT_SECRET
    );

    const staffUser = await User.create({
      name: "Commerce Staff User",
      email: "commerce-staff-user@example.com",
      password: "password123",
      role: "barber",
      isActive: true,
    });
    fixture.staff.user = staffUser._id;
    await fixture.staff.save();

    staffToken = jwt.sign(
      { id: staffUser._id, role: "barber" },
      process.env.JWT_SECRET
    );
  });

  test("allows linked staff with checkout capability to read checkout and payment", async () => {
    payment = await createCapturedPaymentForFixture(fixture, checkout);

    const checkoutRes = await request(app)
      .get(`/checkout/${checkout._id}`)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.data._id).toBe(String(checkout._id));

    const paymentRes = await request(app)
      .get(`/payment/checkout/${checkout._id}`)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(paymentRes.status).toBe(200);
    expect(paymentRes.body.data._id).toBe(String(payment._id));
  });

  test("rejects linked staff without payment capabilities from money mutations", async () => {
    payment = await createCapturedPaymentForFixture(fixture, checkout);

    const captureRes = await request(app)
      .post(`/payment/checkout/${checkout._id}/capture`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ method: "card_manual", amount: 40 });

    expect(captureRes.status).toBe(403);
    expect(captureRes.body.message).toMatch(/required capability/i);

    const refundRes = await request(app)
      .post(`/payment/${payment._id}/refund`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ amount: 10, reason: "not-allowed" });

    expect(refundRes.status).toBe(403);
    expect(refundRes.body.message).toMatch(/required capability/i);

    const voidRes = await request(app)
      .post(`/payment/${payment._id}/void`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ reason: "not-allowed" });

    expect(voidRes.status).toBe(403);
    expect(voidRes.body.message).toMatch(/required capability/i);
  });

  test("rejects a foreign barber capturing payment", async () => {
    const res = await request(app)
      .post(`/payment/checkout/${checkout._id}/capture`)
      .set("Authorization", `Bearer ${foreignBarberToken}`)
      .send({ method: "card_manual", amount: 40 });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/required capability/i);
  });

  test("rejects a foreign barber refunding a payment", async () => {
    payment = await createCapturedPaymentForFixture(fixture, checkout);

    const res = await request(app)
      .post(`/payment/${payment._id}/refund`)
      .set("Authorization", `Bearer ${foreignBarberToken}`)
      .send({ amount: 10, reason: "not-owner" });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/required capability/i);
  });

  test("rejects a foreign barber voiding a payment", async () => {
    payment = await createCapturedPaymentForFixture(fixture, checkout);

    const res = await request(app)
      .post(`/payment/${payment._id}/void`)
      .set("Authorization", `Bearer ${foreignBarberToken}`)
      .send({ reason: "not-owner" });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/required capability/i);
  });

  test("rejects a foreign barber opening cash session", async () => {
    const res = await request(app)
      .post("/cash-sessions/open")
      .set("Authorization", `Bearer ${foreignBarberToken}`)
      .send({
        openingFloat: 50,
        currency: "EUR",
        openingReason: "manual_start",
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/required capability/i);
  });

  test("rejects a foreign barber closing cash session", async () => {
    const openRes = await request(app)
      .post("/cash-sessions/open")
      .set("Authorization", `Bearer ${token}`)
      .send({
        openingFloat: 50,
        currency: "EUR",
        openingReason: "manual_start",
      });

    expect(openRes.status).toBe(201);

    const res = await request(app)
      .post(`/cash-sessions/${openRes.body.data._id}/close`)
      .set("Authorization", `Bearer ${foreignBarberToken}`)
      .send({ closingDeclared: 50 });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/required capability/i);
  });
});
