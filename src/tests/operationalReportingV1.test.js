const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const CashSession = require("../models/cashSession");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const Refund = require("../models/refund");
const {
  createClosedCheckoutForFixture,
  createPaymentCommerceFixture,
  createCapturedPaymentForFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");
const {
  COMMERCE_REPORTING_SCOPE,
} = require("../services/payment/reportingScope");

setupCommerceTestSuite();

const REPORT_DATE = "2026-05-04";
const POLICY_OUTCOME_BASE = {
  reason: "",
  note: "",
  decidedAt: new Date("2026-05-04T09:00:00.000Z"),
  waived: false,
  waiverReason: "",
  feeApplied: false,
  feeAmount: 0,
  blockApplied: false,
  policySource: "test",
  policyVersion: 1,
  scheduledStartAt: new Date("2026-05-04T09:00:00.000Z"),
};

const createAppointmentForFixture = (fixture, overrides = {}) =>
  Appointment.create({
    client: fixture.client._id,
    business: fixture.business._id,
    service: fixture.service._id,
    staff: overrides.staff ?? fixture.staff._id,
    date: overrides.date || new Date(`${REPORT_DATE}T09:00:00.000Z`),
    startTime: overrides.startTime || "09:00",
    endTime: overrides.endTime || "09:45",
    duration: overrides.duration ?? 45,
    status: overrides.status || "Completed",
    bookingStatus: overrides.bookingStatus || "confirmed",
    visitStatus: overrides.visitStatus || "completed",
    visitType: overrides.visitType || "appointment",
    queueStatus: overrides.queueStatus || "none",
    paymentStatus: overrides.paymentStatus || "Paid",
    price: overrides.price ?? 999,
    policySnapshot:
      overrides.policySnapshot || Appointment.buildPolicySnapshot(fixture.business),
    policyOutcome: overrides.policyOutcome,
  });

const setReportingSchedules = async (fixture) => {
  fixture.business.businessHours = {
    ...(fixture.business.businessHours?.toObject?.() ||
      fixture.business.businessHours ||
      {}),
    monday: {
      enabled: true,
      shifts: [{ start: "09:00", end: "13:00" }],
    },
  };
  await fixture.business.save();

  fixture.staff.workingHours = [
    {
      day: "monday",
      enabled: true,
      shifts: [
        {
          start: "09:00",
          end: "13:00",
          breaks: [{ start: "11:00", end: "11:30" }],
        },
      ],
    },
  ];
  fixture.staff.availableForBooking = true;
  fixture.staff.showInCalendar = true;
  await fixture.staff.save();
};

describe("Operational reporting v1", () => {
  let fixture;
  let checkout;
  let token;

  beforeEach(async () => {
    const paymentFixture = await createPaymentCommerceFixture({
      businessName: "Reporting Shop",
      ownerEmail: "reporting-owner@example.com",
    });
    fixture = paymentFixture.fixture;
    checkout = paymentFixture.checkout;
    token = paymentFixture.token;

    await setReportingSchedules(fixture);

    fixture.appointment.date = new Date(`${REPORT_DATE}T09:00:00.000Z`);
    fixture.appointment.startTime = "09:00";
    fixture.appointment.endTime = "09:45";
    fixture.appointment.duration = 45;
    fixture.appointment.status = "Completed";
    fixture.appointment.visitStatus = "completed";
    fixture.appointment.visitType = "appointment";
    fixture.appointment.price = 999;
    await fixture.appointment.save();

    checkout.status = "paid";
    checkout.rebooking = {
      status: "booked",
      appointment: fixture.appointment._id,
      service: fixture.service._id,
      staff: fixture.staff._id,
      createdAt: new Date(`${REPORT_DATE}T09:45:00.000Z`),
      createdBy: fixture.owner._id,
      source: "checkout",
    };
    await checkout.save();

    await createCapturedPaymentForFixture(fixture, checkout, {
      amount: 100,
      subtotal: 90,
      total: 100,
      tip: 10,
      capturedAt: new Date(`${REPORT_DATE}T09:50:00.000Z`),
      reference: "reporting-captured",
    });

    await createAppointmentForFixture(fixture, {
      startTime: "10:00",
      endTime: "10:30",
      duration: 30,
      status: "No-Show",
      visitStatus: "no_show",
      policyOutcome: {
        ...POLICY_OUTCOME_BASE,
        type: "no_show",
      },
    });

    await createAppointmentForFixture(fixture, {
      startTime: "10:30",
      endTime: "11:00",
      duration: 30,
      status: "Canceled",
      bookingStatus: "cancelled",
      visitStatus: "cancelled",
      policyOutcome: {
        ...POLICY_OUTCOME_BASE,
        type: "late_cancel",
      },
    });

    await createAppointmentForFixture(fixture, {
      startTime: "11:30",
      endTime: "12:00",
      duration: 30,
      status: "Completed",
      visitStatus: "completed",
      visitType: "walk_in",
      queueStatus: "completed",
    });

    await createAppointmentForFixture(fixture, {
      startTime: "12:00",
      endTime: "12:30",
      duration: 30,
      status: "Canceled",
      bookingStatus: "cancelled",
      visitStatus: "cancelled",
      visitType: "walk_in",
      queueStatus: "abandoned",
    });

    const partialRefundCheckout = await createClosedCheckoutForFixture(fixture, {
      subtotal: 50,
      total: 50,
      tip: 0,
      openedAt: new Date(`${REPORT_DATE}T12:40:00.000Z`),
    });
    partialRefundCheckout.status = "paid";
    partialRefundCheckout.refundSummary = {
      refundedTotal: 20,
      status: "partial",
    };
    await partialRefundCheckout.save();

    const refundedPayment = await createCapturedPaymentForFixture(
      fixture,
      partialRefundCheckout,
      {
        amount: 50,
        subtotal: 50,
        total: 50,
        tip: 0,
        status: "refunded_partial",
        refundedTotal: 20,
        capturedAt: new Date(`${REPORT_DATE}T12:45:00.000Z`),
        reference: "reporting-partial-refund",
      }
    );

    await Refund.create({
      payment: refundedPayment._id,
      checkout: partialRefundCheckout._id,
      appointment: fixture.appointment._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      amount: 20,
      currency: "EUR",
      reason: "Reporting partial refund",
      refundedAt: new Date(`${REPORT_DATE}T12:50:00.000Z`),
      refundedBy: fixture.owner._id,
    });

    const voidCheckout = await createClosedCheckoutForFixture(fixture, {
      subtotal: 80,
      total: 80,
      tip: 0,
      openedAt: new Date(`${REPORT_DATE}T13:00:00.000Z`),
    });

    await Payment.create({
      paymentScope: "commerce_checkout",
      checkout: voidCheckout._id,
      appointment: fixture.appointment._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      status: "voided",
      method: "card_manual",
      currency: "EUR",
      amount: 80,
      tip: 0,
      reference: "reporting-voided",
      capturedAt: new Date(`${REPORT_DATE}T13:05:00.000Z`),
      capturedBy: fixture.owner._id,
    });

    await Payment.create({
      paymentScope: "platform_billing",
      business: fixture.business._id,
      status: "captured",
      method: "stripe",
      provider: "stripe",
      providerReference: "invoice:reporting-platform",
      providerEventId: "evt_reporting_platform",
      providerCustomerId: "cus_reporting_platform",
      providerSubscriptionId: "sub_reporting_platform",
      currency: "EUR",
      amount: 999,
      tip: 0,
      reference: "reporting-platform",
      capturedAt: new Date(`${REPORT_DATE}T13:10:00.000Z`),
      capturedBy: fixture.owner._id,
    });

    await Checkout.create({
      appointment: fixture.appointment._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      status: "closed",
      currency: "EUR",
      subtotal: 9999,
      discountTotal: 0,
      tip: 0,
      total: 9999,
      sourcePrice: 9999,
      openedAt: new Date(`${REPORT_DATE}T13:20:00.000Z`),
    });

    await CashSession.create({
      business: fixture.business._id,
      status: "closed",
      currency: "EUR",
      openingFloat: 50,
      closingExpected: 150,
      closingDeclared: 155,
      variance: 5,
      varianceStatus: "over",
      summary: {
        cashSalesTotal: 100,
        tipsTotal: 10,
        transactionCount: 1,
        expectedDrawerTotal: 150,
      },
      openedAt: new Date(`${REPORT_DATE}T08:30:00.000Z`),
      openedBy: fixture.owner._id,
      closedAt: new Date(`${REPORT_DATE}T14:00:00.000Z`),
      closedBy: fixture.owner._id,
    });
  });

  test("returns canonical operational reporting without mixing billing, booked revenue or voided payments", async () => {
    const res = await request(app)
      .get(
        `/business/operational-reporting?startDate=${REPORT_DATE}T00:00:00.000Z&endDate=${REPORT_DATE}T23:59:59.999Z`
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.reportingScope.moneyScope).toEqual(
      COMMERCE_REPORTING_SCOPE
    );
    expect(res.body.data.reportingScope.excludes).toEqual(
      expect.arrayContaining([
        "platform_billing",
        "Appointment.price as realized revenue",
        "voided payments from retained transactions",
      ])
    );

    expect(res.body.data.revenue).toMatchObject({
      grossCaptured: 150,
      refundedTotal: 20,
      netRevenue: 130,
      voidedTotal: 80,
      retainedTransactionCount: 2,
      voidedCount: 1,
      aov: 65,
      tipsTotal: 10,
      tipsRate: 0.0667,
    });

    expect(res.body.data.appointments).toMatchObject({
      closedAppointmentCount: 3,
      completedCount: 1,
      noShowCount: 1,
      noShowRate: 0.3333,
      lateCancelCount: 1,
      lateCancelRate: 0.3333,
    });

    expect(res.body.data.rebooking).toMatchObject({
      eligibleCount: 1,
      bookedCount: 1,
      pendingCount: 0,
      followUpNeededCount: 0,
      declinedCount: 0,
      rate: 1,
    });

    expect(res.body.data.cash).toMatchObject({
      closedSessionCount: 1,
      varianceTotal: 5,
      absoluteVarianceTotal: 5,
      overCount: 1,
      shortCount: 0,
      exactCount: 0,
      closingExpectedTotal: 150,
      closingDeclaredTotal: 155,
    });

    expect(res.body.data.walkIns).toMatchObject({
      terminalCount: 2,
      convertedCount: 1,
      lostCount: 1,
      conversionRate: 0.5,
      lostRate: 0.5,
    });

    expect(res.body.data.occupancy).toMatchObject({
      staffCount: 1,
      sellableMinutes: 210,
      occupiedMinutes: 75,
      occupancyRate: 0.3571,
    });
  });

  test("rejects invalid date ranges", async () => {
    const res = await request(app)
      .get(
        `/business/operational-reporting?startDate=${REPORT_DATE}T23:59:59.999Z&endDate=${REPORT_DATE}T00:00:00.000Z`
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("startDate must be before endDate");
  });
});
