const request = require("supertest");
const app = require("../app");
const CashSession = require("../models/cashSession");
const Payment = require("../models/payment");
const Refund = require("../models/refund");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCapturedPaymentForFixture,
  createPaymentCommerceFixture,
} = require("./helpers/commerceFixture");

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("Commerce input validation v1", () => {
  let fixture;
  let checkout;
  let token;

  beforeEach(async () => {
    ({ fixture, checkout, token } = await createPaymentCommerceFixture({
      ownerName: "Input Validation Owner",
      ownerEmail: "input-validation-owner@example.com",
      businessName: "Input Validation Shop",
    }));
  });

  const authPost = (route) =>
    request(app).post(route).set("Authorization", `Bearer ${token}`);

  const authPut = (route) =>
    request(app).put(route).set("Authorization", `Bearer ${token}`);

  const authGet = (route) =>
    request(app).get(route).set("Authorization", `Bearer ${token}`);

  test("rejects malformed commerce route ids before database lookup", async () => {
    const paymentCount = await Payment.countDocuments();

    const captureRes = await authPost("/payment/checkout/not-an-id/capture").send({
      method: "card_manual",
      amount: 40,
    });

    expect(captureRes.status).toBe(400);
    expect(captureRes.body.message).toMatch(/checkoutId/i);
    expect(await Payment.countDocuments()).toBe(paymentCount);

    const checkoutRes = await authGet("/checkout/not-an-id");
    expect(checkoutRes.status).toBe(400);
    expect(checkoutRes.body.message).toMatch(/id/i);
  });

  test("rejects invalid payment capture payloads before creating payments", async () => {
    const paymentCount = await Payment.countDocuments();

    const invalidAmountRes = await authPost(
      `/payment/checkout/${checkout._id}/capture`
    ).send({
      method: "card_manual",
      amount: "",
    });

    expect(invalidAmountRes.status).toBe(400);
    expect(invalidAmountRes.body.message).toMatch(/amount/i);

    const invalidMethodRes = await authPost(
      `/payment/checkout/${checkout._id}/capture`
    ).send({
      method: "wallet",
      amount: 40,
    });

    expect(invalidMethodRes.status).toBe(400);
    expect(invalidMethodRes.body.message).toMatch(/method/i);
    expect(await Payment.countDocuments()).toBe(paymentCount);
  });

  test("rejects invalid refund payloads before creating refunds", async () => {
    const payment = await createCapturedPaymentForFixture(fixture, checkout);
    const refundCount = await Refund.countDocuments();

    const invalidRefundRes = await authPost(`/payment/${payment._id}/refund`).send({
      amount: -1,
      reason: "bad refund",
    });

    expect(invalidRefundRes.status).toBe(400);
    expect(invalidRefundRes.body.message).toMatch(/amount/i);
    expect(await Refund.countDocuments()).toBe(refundCount);
  });

  test("rejects invalid checkout write payloads before checkout mutation", async () => {
    const invalidCloseRes = await authPost(`/checkout/${checkout._id}/close`).send({
      tip: -5,
    });

    expect(invalidCloseRes.status).toBe(400);
    expect(invalidCloseRes.body.message).toMatch(/tip/i);

    const invalidServiceLinesRes = await authPut(
      `/checkout/${checkout._id}/service-lines`
    ).send({
      serviceLines: [
        {
          serviceId: "not-an-id",
        },
      ],
    });

    expect(invalidServiceLinesRes.status).toBe(400);
    expect(invalidServiceLinesRes.body.message).toMatch(/serviceId/i);

    const invalidRebookingRes = await authPost(
      `/checkout/${checkout._id}/rebook`
    ).send({
      date: "2026-99-99",
      startTime: "25:00",
    });

    expect(invalidRebookingRes.status).toBe(400);
    expect(invalidRebookingRes.body.message).toMatch(/date|startTime/i);
  });

  test("rejects invalid cash session payloads before cash mutation", async () => {
    const invalidOpenRes = await authPost("/cash-sessions/open").send({
      openingFloat: -1,
    });

    expect(invalidOpenRes.status).toBe(400);
    expect(invalidOpenRes.body.message).toMatch(/openingFloat/i);
    expect(await CashSession.countDocuments()).toBe(0);

    const invalidCloseRes = await authPost("/cash-sessions/not-an-id/close").send({
      closingDeclared: 50,
    });

    expect(invalidCloseRes.status).toBe(400);
    expect(invalidCloseRes.body.message).toMatch(/id/i);

    const invalidQueryRes = await authGet("/cash-sessions/report").query({
      status: "archived",
    });

    expect(invalidQueryRes.status).toBe(400);
    expect(invalidQueryRes.body.message).toMatch(/status/i);
  });
});
