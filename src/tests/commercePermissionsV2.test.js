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
  });

  test("rejects a foreign barber capturing payment", async () => {
    const res = await request(app)
      .post(`/payment/checkout/${checkout._id}/capture`)
      .set("Authorization", `Bearer ${foreignBarberToken}`)
      .send({ method: "card_manual", amount: 40 });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/business owner/i);
  });

  test("rejects a foreign barber refunding a payment", async () => {
    payment = await createCapturedPaymentForFixture(fixture, checkout);

    const res = await request(app)
      .post(`/payment/${payment._id}/refund`)
      .set("Authorization", `Bearer ${foreignBarberToken}`)
      .send({ amount: 10, reason: "not-owner" });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/business owner/i);
  });

  test("rejects a foreign barber voiding a payment", async () => {
    payment = await createCapturedPaymentForFixture(fixture, checkout);

    const res = await request(app)
      .post(`/payment/${payment._id}/void`)
      .set("Authorization", `Bearer ${foreignBarberToken}`)
      .send({ reason: "not-owner" });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/business owner/i);
  });

  test("rejects a foreign barber opening cash session", async () => {
    const res = await request(app)
      .post("/cash-sessions/open")
      .set("Authorization", `Bearer ${foreignBarberToken}`)
      .send({ openingFloat: 50, currency: "EUR" });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/business owner/i);
  });

  test("rejects a foreign barber closing cash session", async () => {
    const openRes = await request(app)
      .post("/cash-sessions/open")
      .set("Authorization", `Bearer ${token}`)
      .send({ openingFloat: 50, currency: "EUR" });

    expect(openRes.status).toBe(201);

    const res = await request(app)
      .post(`/cash-sessions/${openRes.body.data._id}/close`)
      .set("Authorization", `Bearer ${foreignBarberToken}`)
      .send({ closingDeclared: 50 });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/business owner/i);
  });
});
