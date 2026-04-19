const request = require("supertest");
const app = require("../app");
const Checkout = require("../models/checkout");
const Refund = require("../models/refund");
const {
  createPaymentCommerceFixture,
  createCapturedPaymentForFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

describe("Payment summary v1", () => {
  let fixture;
  let token;
  let paidCheckout;
  let refundCheckout;
  let voidCheckout;

  beforeEach(async () => {
    ({ fixture, token } = await createPaymentCommerceFixture({
      ownerName: "Summary Owner",
      ownerEmail: "summary-owner@example.com",
      businessName: "Summary Shop",
    }));

    paidCheckout = await Checkout.create({
      appointment: fixture.appointment._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      status: "paid",
      currency: "EUR",
      subtotal: 35,
      discountTotal: 0,
      tip: 5,
      total: 40,
      sourcePrice: 35,
      snapshot: {
        service: { id: fixture.service._id, name: fixture.service.name },
        client: {
          id: fixture.client._id,
          firstName: fixture.client.firstName,
          lastName: fixture.client.lastName,
        },
      },
      openedAt: new Date("2026-04-19T09:00:00.000Z"),
      rebooking: {
        status: "booked",
        appointment: fixture.appointment._id,
        service: fixture.service._id,
        staff: fixture.staff._id,
        createdAt: new Date("2026-04-19T09:30:00.000Z"),
        createdBy: fixture.owner._id,
      },
    });

    refundCheckout = await Checkout.create({
      appointment: fixture.appointment._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      status: "paid",
      currency: "EUR",
      subtotal: 50,
      discountTotal: 0,
      tip: 0,
      total: 50,
      sourcePrice: 50,
      snapshot: {
        service: { id: fixture.service._id, name: fixture.service.name },
        client: {
          id: fixture.client._id,
          firstName: fixture.client.firstName,
          lastName: fixture.client.lastName,
        },
      },
      openedAt: new Date("2026-04-19T10:00:00.000Z"),
    });

    voidCheckout = await Checkout.create({
      appointment: fixture.appointment._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      status: "closed",
      currency: "EUR",
      subtotal: 25,
      discountTotal: 0,
      tip: 0,
      total: 25,
      sourcePrice: 25,
      snapshot: {
        service: { id: fixture.service._id, name: fixture.service.name },
        client: {
          id: fixture.client._id,
          firstName: fixture.client.firstName,
          lastName: fixture.client.lastName,
        },
      },
      openedAt: new Date("2026-04-19T11:00:00.000Z"),
    });

    await createCapturedPaymentForFixture(fixture, paidCheckout, {
      amount: 40,
      method: "cash",
      capturedAt: new Date("2026-04-19T09:10:00.000Z"),
      reference: "summary-paid",
    });

    const refundedPayment = await createCapturedPaymentForFixture(
      fixture,
      refundCheckout,
      {
        amount: 50,
        method: "card_manual",
        status: "refunded_partial",
        refundedTotal: 10,
        capturedAt: new Date("2026-04-19T10:10:00.000Z"),
        reference: "summary-refunded",
      }
    );

    await Refund.create({
      payment: refundedPayment._id,
      checkout: refundCheckout._id,
      appointment: fixture.appointment._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      amount: 10,
      currency: "EUR",
      reason: "Summary refund",
      refundedAt: new Date("2026-04-19T10:20:00.000Z"),
      refundedBy: fixture.owner._id,
    });

    await createCapturedPaymentForFixture(fixture, voidCheckout, {
      amount: 25,
      method: "other",
      status: "voided",
      capturedAt: new Date("2026-04-19T11:10:00.000Z"),
      reference: "summary-voided",
    });
  });

  test("returns canonical commerce summary from payment, refund and checkout data", async () => {
    const res = await request(app)
      .get("/payment/summary?startDate=2026-04-19T00:00:00.000Z&endDate=2026-04-19T23:59:59.999Z")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.grossCaptured).toBe(90);
    expect(res.body.data.refundedTotal).toBe(10);
    expect(res.body.data.netCaptured).toBe(80);
    expect(res.body.data.voidedTotal).toBe(25);
    expect(res.body.data.transactionCount).toBe(3);
    expect(res.body.data.capturedCount).toBe(1);
    expect(res.body.data.refundedPartialCount).toBe(1);
    expect(res.body.data.refundedFullCount).toBe(0);
    expect(res.body.data.voidedCount).toBe(1);
    expect(res.body.data.methodBreakdown.cash).toBe(40);
    expect(res.body.data.methodBreakdown.card_manual).toBe(50);
    expect(res.body.data.methodBreakdown.other).toBe(0);
    expect(res.body.data.rebooking.count).toBe(1);
  });
});
