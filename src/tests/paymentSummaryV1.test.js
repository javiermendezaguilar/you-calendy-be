const request = require("supertest");
const app = require("../app");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const Refund = require("../models/refund");
const {
  createPaymentCommerceFixture,
  createCapturedPaymentForFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");
const {
  COMMERCE_REPORTING_SCOPE,
} = require("../services/payment/reportingScope");

setupCommerceTestSuite();

const createSummaryCheckout = (fixture, overrides = {}) => {
  const subtotal = overrides.subtotal ?? overrides.total ?? 0;
  const total = overrides.total ?? subtotal;
  const serviceLines = overrides.serviceLines || [
    {
      service: { id: fixture.service._id, name: fixture.service.name },
      staff: {
        id: fixture.staff._id,
        firstName: fixture.staff.firstName,
        lastName: fixture.staff.lastName,
      },
      quantity: 1,
      unitPrice: subtotal,
      durationMinutes: fixture.appointment.duration,
      adjustmentAmount: 0,
      lineTotal: subtotal,
      source: "reserved_service_default",
      note: "",
    },
  ];

  return Checkout.create({
    appointment: fixture.appointment._id,
    business: fixture.business._id,
    client: fixture.client._id,
    staff: fixture.staff._id,
    status: overrides.status || "paid",
    currency: "EUR",
    subtotal,
    discountTotal: overrides.discountTotal ?? 0,
    tip: overrides.tip ?? 0,
    total,
    sourcePrice: overrides.sourcePrice ?? subtotal,
    serviceLines,
    snapshot: {
      service: { id: fixture.service._id, name: fixture.service.name },
      serviceLines,
      client: {
        id: fixture.client._id,
        firstName: fixture.client.firstName,
        lastName: fixture.client.lastName,
      },
    },
    openedAt: overrides.openedAt,
    rebooking: overrides.rebooking,
  });
};

describe("Payment summary v1", () => {
  let fixture;
  let token;
  let paidCheckout;
  let refundCheckout;
  let voidCheckout;
  let followUpCheckout;
  let declinedCheckout;
  let pendingRebookingCheckout;

  beforeEach(async () => {
    ({ fixture, token } = await createPaymentCommerceFixture({
      ownerName: "Summary Owner",
      ownerEmail: "summary-owner@example.com",
      businessName: "Summary Shop",
    }));

    paidCheckout = await createSummaryCheckout(fixture, {
      subtotal: 35,
      tip: 5,
      total: 40,
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

    refundCheckout = await createSummaryCheckout(fixture, {
      total: 50,
      openedAt: new Date("2026-04-19T10:00:00.000Z"),
    });

    voidCheckout = await createSummaryCheckout(fixture, {
      status: "closed",
      total: 25,
      openedAt: new Date("2026-04-19T11:00:00.000Z"),
    });

    followUpCheckout = await createSummaryCheckout(fixture, {
      total: 30,
      openedAt: new Date("2026-04-19T12:00:00.000Z"),
      rebooking: {
        status: "follow_up_needed",
        source: "checkout",
        note: "Call tomorrow",
        offeredAt: new Date("2026-04-19T12:10:00.000Z"),
        outcomeAt: new Date("2026-04-19T12:15:00.000Z"),
        outcomeBy: fixture.owner._id,
      },
    });

    declinedCheckout = await createSummaryCheckout(fixture, {
      total: 20,
      openedAt: new Date("2026-04-19T13:00:00.000Z"),
      rebooking: {
        status: "declined",
        source: "checkout",
        offeredAt: new Date("2026-04-19T13:10:00.000Z"),
        outcomeAt: new Date("2026-04-19T13:15:00.000Z"),
        outcomeBy: fixture.owner._id,
      },
    });

    pendingRebookingCheckout = await createSummaryCheckout(fixture, {
      total: 15,
      openedAt: new Date("2026-04-19T14:00:00.000Z"),
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
        subtotal: 50,
        tip: 0,
        total: 50,
        serviceLines: refundCheckout.serviceLines,
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

    await createCapturedPaymentForFixture(fixture, followUpCheckout, {
      amount: 30,
      method: "card_manual",
      capturedAt: new Date("2026-04-20T12:10:00.000Z"),
      reference: "summary-follow-up",
    });

    await createCapturedPaymentForFixture(fixture, declinedCheckout, {
      amount: 20,
      method: "card_manual",
      capturedAt: new Date("2026-04-20T13:10:00.000Z"),
      reference: "summary-declined",
    });

    await createCapturedPaymentForFixture(fixture, pendingRebookingCheckout, {
      amount: 15,
      method: "card_manual",
      capturedAt: new Date("2026-04-20T14:10:00.000Z"),
      reference: "summary-pending-rebooking",
    });

    await Payment.create({
      paymentScope: "platform_billing",
      business: fixture.business._id,
      status: "captured",
      method: "stripe",
      provider: "stripe",
      providerReference: "invoice:summary-platform",
      providerEventId: "evt_summary_platform",
      providerCustomerId: "cus_summary_platform",
      providerSubscriptionId: "sub_summary_platform",
      currency: "EUR",
      amount: 99,
      tip: 0,
      reference: "summary-platform",
      capturedAt: new Date("2026-04-19T12:10:00.000Z"),
      capturedBy: fixture.owner._id,
      snapshot: {
        subtotal: 99,
        discountTotal: 0,
        total: 99,
        sourcePrice: 99,
        service: { id: null, name: "" },
        client: { id: null, firstName: "", lastName: "" },
        discounts: { promotionAmount: 0, flashSaleAmount: 0 },
      },
    });
  });

  test("returns canonical commerce summary from payment, refund and checkout data", async () => {
    const res = await request(app)
      .get("/payment/summary?startDate=2026-04-19T00:00:00.000Z&endDate=2026-04-19T23:59:59.999Z")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.moneyScope).toEqual(COMMERCE_REPORTING_SCOPE);
    expect(res.body.data.grossCaptured).toBe(90);
    expect(res.body.data.refundedTotal).toBe(10);
    expect(res.body.data.netCaptured).toBe(80);
    expect(res.body.data.voidedTotal).toBe(25);
    expect(res.body.data.transactionCount).toBe(2);
    expect(res.body.data.capturedCount).toBe(1);
    expect(res.body.data.refundedPartialCount).toBe(1);
    expect(res.body.data.refundedFullCount).toBe(0);
    expect(res.body.data.voidedCount).toBe(1);
    expect(res.body.data.methodBreakdown.cash).toBe(40);
    expect(res.body.data.methodBreakdown.card_manual).toBe(50);
    expect(res.body.data.methodBreakdown.other).toBe(0);
    expect(res.body.data.rebooking.count).toBe(1);
    expect(res.body.data.rebooking.eligibleCount).toBe(4);
    expect(res.body.data.rebooking.bookedCount).toBe(1);
    expect(res.body.data.rebooking.pendingCount).toBe(1);
    expect(res.body.data.rebooking.followUpNeededCount).toBe(1);
    expect(res.body.data.rebooking.declinedCount).toBe(1);
    expect(res.body.data.rebooking.rate).toBe(0.25);
  });

  test("returns service revenue from performed service snapshots only", async () => {
    const legacyCheckout = await createSummaryCheckout(fixture, {
      total: 60,
      openedAt: new Date("2026-04-19T15:00:00.000Z"),
    });

    await Payment.create({
      paymentScope: "commerce_checkout",
      checkout: legacyCheckout._id,
      appointment: fixture.appointment._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      status: "captured",
      method: "card_manual",
      currency: "EUR",
      amount: 60,
      tip: 0,
      reference: "summary-legacy-service",
      capturedAt: new Date("2026-04-19T15:10:00.000Z"),
      capturedBy: fixture.owner._id,
      snapshot: {
        subtotal: 60,
        discountTotal: 0,
        total: 60,
        sourcePrice: 60,
        service: { id: fixture.service._id, name: "Legacy Reserved Service" },
        client: {
          id: fixture.client._id,
          firstName: fixture.client.firstName,
          lastName: fixture.client.lastName,
        },
        discounts: { promotionAmount: 0, flashSaleAmount: 0 },
      },
    });
    const fullRefundCheckout = await createSummaryCheckout(fixture, {
      total: 30,
      openedAt: new Date("2026-04-19T16:00:00.000Z"),
    });

    await createCapturedPaymentForFixture(fixture, fullRefundCheckout, {
      amount: 30,
      method: "card_manual",
      status: "refunded_full",
      refundedTotal: 30,
      subtotal: 30,
      tip: 0,
      total: 30,
      serviceLines: fullRefundCheckout.serviceLines,
      capturedAt: new Date("2026-04-19T16:10:00.000Z"),
      reference: "summary-full-refund",
    });

    const res = await request(app)
      .get("/payment/summary?startDate=2026-04-19T00:00:00.000Z&endDate=2026-04-19T23:59:59.999Z")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.serviceBreakdown).toMatchObject({
      source: "payment_snapshot_service_lines",
      attributionScope: "performed_service_snapshot",
      excludes: ["platform_billing", "voided", "tips"],
    });

    const serviceItem = res.body.data.serviceBreakdown.items.find(
      (item) => item.serviceId === fixture.service._id.toString()
    );
    expect(serviceItem).toMatchObject({
      serviceName: fixture.service.name,
      quantity: 3,
      lineCount: 3,
      paymentCount: 3,
      grossServiceRevenue: 115,
      netServiceRevenue: 75,
    });

    expect(res.body.data.serviceBreakdown.unattributed).toMatchObject({
      reason: "missing_payment_snapshot_service_lines",
      paymentCount: 1,
      grossServiceRevenue: 60,
      netServiceRevenue: 60,
    });
  });
});
