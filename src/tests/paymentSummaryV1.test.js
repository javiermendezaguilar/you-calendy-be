const request = require("supertest");
const app = require("../app");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const Refund = require("../models/refund");
const Staff = require("../models/staff");
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

const buildSummaryServiceLine = ({
  fixture,
  staff = fixture.staff,
  lineTotal,
  quantity = 1,
}) => ({
  service: { id: fixture.service._id, name: fixture.service.name },
  staff: staff
    ? {
        id: staff._id,
        firstName: staff.firstName,
        lastName: staff.lastName,
      }
    : undefined,
  quantity,
  unitPrice: lineTotal / quantity,
  durationMinutes: fixture.appointment.duration,
  adjustmentAmount: 0,
  lineTotal,
  source: "manual_adjustment",
  note: "",
});

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

  test("rejects invalid summary period filters before building the read model", async () => {
    const res = await request(app)
      .get("/payment/summary?startDate=not-a-date")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/startDate/i);
  });

  test("rejects summary periods with startDate after endDate", async () => {
    const res = await request(app)
      .get("/payment/summary?startDate=2026-04-20&endDate=2026-04-19")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/before or equal to endDate/i);
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

  test("returns staff revenue from performed service line staff snapshots only", async () => {
    const secondStaff = await Staff.create({
      business: fixture.business._id,
      firstName: "Morgan",
      lastName: "Blade",
      email: "morgan.blade@example.com",
    });
    const primaryStaffName = `${fixture.staff.firstName} ${fixture.staff.lastName}`;
    const secondStaffName = `${secondStaff.firstName} ${secondStaff.lastName}`;

    const multiStaffCheckout = await createSummaryCheckout(fixture, {
      subtotal: 60,
      tip: 5,
      total: 65,
      openedAt: new Date("2026-04-21T09:00:00.000Z"),
      serviceLines: [
        buildSummaryServiceLine({ fixture, lineTotal: 40 }),
        buildSummaryServiceLine({
          fixture,
          staff: secondStaff,
          lineTotal: 20,
        }),
      ],
    });

    await createCapturedPaymentForFixture(fixture, multiStaffCheckout, {
      amount: 65,
      tip: 5,
      subtotal: 60,
      total: 65,
      serviceLines: multiStaffCheckout.serviceLines,
      capturedAt: new Date("2026-04-21T09:10:00.000Z"),
      reference: "summary-staff-multi",
    });

    const partialRefundCheckout = await createSummaryCheckout(fixture, {
      subtotal: 60,
      total: 60,
      openedAt: new Date("2026-04-21T10:00:00.000Z"),
      serviceLines: [
        buildSummaryServiceLine({ fixture, lineTotal: 30 }),
        buildSummaryServiceLine({
          fixture,
          staff: secondStaff,
          lineTotal: 30,
        }),
      ],
    });

    await createCapturedPaymentForFixture(fixture, partialRefundCheckout, {
      amount: 60,
      status: "refunded_partial",
      refundedTotal: 15,
      subtotal: 60,
      tip: 0,
      total: 60,
      serviceLines: partialRefundCheckout.serviceLines,
      capturedAt: new Date("2026-04-21T10:10:00.000Z"),
      reference: "summary-staff-partial-refund",
    });

    const fullRefundCheckout = await createSummaryCheckout(fixture, {
      subtotal: 10,
      total: 10,
      openedAt: new Date("2026-04-21T11:00:00.000Z"),
      serviceLines: [buildSummaryServiceLine({ fixture, lineTotal: 10 })],
    });

    await createCapturedPaymentForFixture(fixture, fullRefundCheckout, {
      amount: 10,
      status: "refunded_full",
      refundedTotal: 10,
      subtotal: 10,
      tip: 0,
      total: 10,
      serviceLines: fullRefundCheckout.serviceLines,
      capturedAt: new Date("2026-04-21T11:10:00.000Z"),
      reference: "summary-staff-full-refund",
    });

    const legacyCheckout = await createSummaryCheckout(fixture, {
      subtotal: 60,
      total: 60,
      openedAt: new Date("2026-04-21T12:00:00.000Z"),
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
      reference: "summary-staff-legacy",
      capturedAt: new Date("2026-04-21T12:10:00.000Z"),
      capturedBy: fixture.owner._id,
      snapshot: {
        subtotal: 60,
        discountTotal: 0,
        total: 60,
        sourcePrice: 60,
        service: { id: fixture.service._id, name: fixture.service.name },
        client: {
          id: fixture.client._id,
          firstName: fixture.client.firstName,
          lastName: fixture.client.lastName,
        },
        discounts: { promotionAmount: 0, flashSaleAmount: 0 },
      },
    });

    const missingStaffCheckout = await createSummaryCheckout(fixture, {
      subtotal: 25,
      total: 25,
      openedAt: new Date("2026-04-21T13:00:00.000Z"),
      serviceLines: [
        buildSummaryServiceLine({
          fixture,
          staff: null,
          lineTotal: 25,
        }),
      ],
    });

    await createCapturedPaymentForFixture(fixture, missingStaffCheckout, {
      amount: 25,
      subtotal: 25,
      tip: 0,
      total: 25,
      serviceLines: missingStaffCheckout.serviceLines,
      capturedAt: new Date("2026-04-21T13:10:00.000Z"),
      reference: "summary-staff-missing-staff",
    });

    const voidedCheckout = await createSummaryCheckout(fixture, {
      subtotal: 100,
      total: 100,
      openedAt: new Date("2026-04-21T14:00:00.000Z"),
      serviceLines: [buildSummaryServiceLine({ fixture, lineTotal: 100 })],
    });

    await createCapturedPaymentForFixture(fixture, voidedCheckout, {
      amount: 100,
      status: "voided",
      subtotal: 100,
      tip: 0,
      total: 100,
      serviceLines: voidedCheckout.serviceLines,
      capturedAt: new Date("2026-04-21T14:10:00.000Z"),
      reference: "summary-staff-voided",
    });

    await Payment.create({
      paymentScope: "platform_billing",
      business: fixture.business._id,
      status: "captured",
      method: "stripe",
      provider: "stripe",
      providerReference: "invoice:summary-staff-platform",
      providerEventId: "evt_summary_staff_platform",
      providerCustomerId: "cus_summary_staff_platform",
      providerSubscriptionId: "sub_summary_staff_platform",
      currency: "EUR",
      amount: 999,
      tip: 0,
      reference: "summary-staff-platform",
      capturedAt: new Date("2026-04-21T15:10:00.000Z"),
      capturedBy: fixture.owner._id,
    });

    const res = await request(app)
      .get("/payment/summary?startDate=2026-04-21T00:00:00.000Z&endDate=2026-04-21T23:59:59.999Z")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.staffBreakdown).toMatchObject({
      source: "payment_snapshot_service_lines",
      attributionScope: "performed_staff_snapshot",
      excludes: ["platform_billing", "voided", "tips"],
    });

    const primaryStaffItem = res.body.data.staffBreakdown.items.find(
      (item) => item.staffId === fixture.staff._id.toString()
    );
    expect(primaryStaffItem).toMatchObject({
      staffName: primaryStaffName,
      quantity: 3,
      lineCount: 3,
      paymentCount: 3,
      grossStaffRevenue: 80,
      netStaffRevenue: 62.5,
    });

    const secondStaffItem = res.body.data.staffBreakdown.items.find(
      (item) => item.staffId === secondStaff._id.toString()
    );
    expect(secondStaffItem).toMatchObject({
      staffName: secondStaffName,
      quantity: 2,
      lineCount: 2,
      paymentCount: 2,
      grossStaffRevenue: 50,
      netStaffRevenue: 42.5,
    });

    expect(res.body.data.staffBreakdown.unattributed).toMatchObject({
      reason: "missing_staff_or_service_line_snapshot",
      paymentCount: 2,
      lineCount: 1,
      grossStaffRevenue: 85,
      netStaffRevenue: 85,
    });
  });

  test("allocates totalized product tax and discount payments to service revenue without tips", async () => {
    const serviceLines = [buildSummaryServiceLine({ fixture, lineTotal: 50 })];
    const checkout = await createSummaryCheckout(fixture, {
      subtotal: 62,
      tip: 3,
      total: 65.7,
      openedAt: new Date("2026-04-22T09:00:00.000Z"),
      serviceLines,
    });

    await Payment.create({
      paymentScope: "commerce_checkout",
      checkout: checkout._id,
      appointment: fixture.appointment._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      status: "captured",
      method: "card_manual",
      currency: "EUR",
      amount: 65.7,
      tip: 3,
      reference: "summary-totalized-checkout",
      capturedAt: new Date("2026-04-22T09:10:00.000Z"),
      capturedBy: fixture.owner._id,
      snapshot: {
        subtotal: 62,
        discountTotal: 5,
        total: 65.7,
        sourcePrice: 62,
        serviceLines,
        productLines: [
          {
            name: "Pomade",
            quantity: 2,
            unitPrice: 6,
            adjustmentAmount: 0,
            lineTotal: 12,
            source: "manual",
            note: "",
          },
        ],
        discountLines: [
          {
            label: "Loyalty",
            source: "manual",
            amount: 5,
            rate: 0,
            note: "",
          },
        ],
        taxLines: [
          {
            label: "VAT",
            source: "vat",
            amount: 5.7,
            rate: 10,
            note: "",
          },
        ],
        totalization: {
          serviceSubtotal: 50,
          productSubtotal: 12,
          subtotal: 62,
          discountTotal: 5,
          taxableSubtotal: 57,
          taxTotal: 5.7,
          tipTotal: 3,
          totalBeforeDeposit: 65.7,
          depositAppliedTotal: 0,
          amountDue: 65.7,
          refundTotal: 0,
        },
        service: { id: fixture.service._id, name: fixture.service.name },
        client: {
          id: fixture.client._id,
          firstName: fixture.client.firstName,
          lastName: fixture.client.lastName,
        },
        discounts: { promotionAmount: 0, flashSaleAmount: 0 },
      },
    });

    const res = await request(app)
      .get("/payment/summary?startDate=2026-04-22T00:00:00.000Z&endDate=2026-04-22T23:59:59.999Z")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const serviceItem = res.body.data.serviceBreakdown.items.find(
      (item) => item.serviceId === fixture.service._id.toString()
    );

    expect(serviceItem).toMatchObject({
      grossServiceRevenue: 50,
      netServiceRevenue: 45.97,
    });
  });
});
