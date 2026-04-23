const moment = require("moment");
const request = require("supertest");
const app = require("../app");
const CashSession = require("../models/cashSession");
const WaitlistEntry = require("../models/waitlistEntry");
const Payment = require("../models/payment");
const {
  createPaymentCommerceFixture,
  createCapturedPaymentForFixture,
  assignPrimaryServiceToStaff,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

const getOperationalDashboard = (token, query) =>
  request(app)
    .get("/business/operational-dashboard")
    .set("Authorization", `Bearer ${token}`)
    .query(query);

const expectRetainedCommerceSummary = (res, expectedAmount) => {
  expect(res.body.data.commerceToday.grossCaptured).toBe(expectedAmount);
  expect(res.body.data.commerceToday.netCaptured).toBe(expectedAmount);
  expect(res.body.data.commerceToday.transactionCount).toBe(1);
  expect(res.body.data.commerceToday.staffBreakdown).toHaveLength(1);
  expect(res.body.data.commerceToday.staffBreakdown[0].grossCaptured).toBe(
    expectedAmount
  );
  expect(res.body.data.commerceToday.staffBreakdown[0].transactionCount).toBe(1);
};

describe("Operational dashboard v1", () => {
  let fixture;
  let checkout;
  let token;
  let today;

  beforeEach(async () => {
    const paymentFixture = await createPaymentCommerceFixture();
    fixture = paymentFixture.fixture;
    checkout = paymentFixture.checkout;
    token = paymentFixture.token;
    today = "2026-05-01";
    const stuckAppointmentStart = moment(`${today} 08:00`, "YYYY-MM-DD HH:mm");

    await assignPrimaryServiceToStaff(fixture.staff, fixture.service, 30);

    fixture.appointment.status = "Confirmed";
    fixture.appointment.bookingStatus = "confirmed";
    fixture.appointment.visitStatus = "in_service";
    fixture.appointment.date = moment(today, "YYYY-MM-DD").toDate();
    fixture.appointment.startTime = stuckAppointmentStart.format("HH:mm");
    fixture.appointment.endTime = stuckAppointmentStart
      .clone()
      .add(45, "minutes")
      .format("HH:mm");
    fixture.appointment.operationalTimestamps = {
      checkedInAt: new Date(),
      checkedInBy: fixture.owner._id,
      serviceStartedAt: new Date(),
      serviceStartedBy: fixture.owner._id,
    };
    await fixture.appointment.save();

    await CashSession.deleteMany({});
    await WaitlistEntry.deleteMany({});
  });

  test("returns queue, waitlist, cash session, commerce summary and operational actions", async () => {
    const queueStartTime = "10:00";
    const waitlistWindowStart = "10:00";
    const waitlistWindowEnd = "12:00";
    const dashboardFromTime = "09:30";
    const operationalTimestamp = new Date(`${today}T11:00:00.000Z`);

    const walkInRes = await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: fixture.client._id,
        serviceId: fixture.service._id,
        staffId: fixture.staff._id,
        date: today,
        startTime: queueStartTime,
      });
    expect(walkInRes.status).toBe(201);

    const waitlistRes = await request(app)
      .post("/business/waitlist")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: fixture.client._id,
        serviceId: fixture.service._id,
        staffId: fixture.staff._id,
        date: today,
        timeWindowStart: waitlistWindowStart,
        timeWindowEnd: waitlistWindowEnd,
        notes: "dashboard fit",
      });
    expect(waitlistRes.status).toBe(201);

    const cashSession = await CashSession.create({
      business: fixture.business._id,
      status: "open",
      currency: "EUR",
      openingFloat: 50,
      closingExpected: 95,
      summary: {
        cashSalesTotal: 40,
        tipsTotal: 5,
        transactionCount: 1,
        expectedDrawerTotal: 95,
      },
      openedAt: operationalTimestamp,
      openedBy: fixture.owner._id,
    });

    const payment = await createCapturedPaymentForFixture(fixture, checkout, {
      method: "cash",
      amount: 40,
      tip: 5,
      capturedAt: operationalTimestamp,
    });

    payment.cashSession = cashSession._id;
    await payment.save();

    const res = await getOperationalDashboard(token, {
      date: today,
      fromTime: dashboardFromTime,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.queue.activeCount).toBe(1);
    expect(res.body.data.queue.staffBreakdown).toHaveLength(1);
    expect(res.body.data.queue.staffBreakdown[0].staff._id.toString()).toBe(
      fixture.staff._id.toString()
    );
    expect(res.body.data.queue.staffBreakdown[0].activeCount).toBe(1);
    expect(res.body.data.waitlist.activeCount).toBe(1);
    expect(res.body.data.waitlist.fillGapCount).toBe(1);
    expect(res.body.data.cashSession.active).toBe(true);
    expect(res.body.data.cashSession.openingFloat).toBe(50);
    expect(res.body.data.cashSession.closing.ready).toBe(true);
    expect(res.body.data.cashSession.closing.transactionCount).toBe(1);
    expectRetainedCommerceSummary(res, 40);
    expect(res.body.data.stuckAppointments.length).toBeGreaterThanOrEqual(1);
    expect(
      res.body.data.stuckAppointments.some(
        (item) => item.visitStatus === "in_service"
      )
    ).toBe(true);
    expect(
      res.body.data.stuckAppointments.some(
        (item) => item.visitStatus === "checked_in"
      )
    ).toBe(true);
    expect(
      res.body.data.nextActions.some(
        (item) => item.type === "serve_next_walk_in"
      )
    ).toBe(true);
    expect(
      res.body.data.nextActions.some(
        (item) => item.type === "review_fill_gaps"
      )
    ).toBe(true);
    expect(
      res.body.data.alerts.some(
        (item) => item.type === "waitlist_opportunity"
      )
    ).toBe(true);
    expect(
      res.body.data.alerts.some((item) => item.type === "no_cash_session")
    ).toBe(false);
  });

  test("does not count voided payments as retained commerce in the operational dashboard", async () => {
    const operationalTimestamp = new Date(`${today}T11:00:00.000Z`);

    await createCapturedPaymentForFixture(fixture, checkout, {
      method: "cash",
      amount: 40,
      tip: 0,
      capturedAt: operationalTimestamp,
      reference: "dashboard-captured",
    });

    await Payment.create({
      checkout: checkout._id,
      appointment: fixture.appointment._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      status: "voided",
      method: "cash",
      currency: "EUR",
      amount: 25,
      tip: 0,
      reference: "dashboard-voided",
      capturedAt: operationalTimestamp,
      capturedBy: fixture.owner._id,
      snapshot: {
        subtotal: 25,
        discountTotal: 0,
        total: 25,
        sourcePrice: 25,
      },
    });

    const res = await getOperationalDashboard(token, {
      date: today,
      fromTime: "09:30",
    });

    expect(res.status).toBe(200);
    expectRetainedCommerceSummary(res, 40);
  });
});
