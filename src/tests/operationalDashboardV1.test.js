const moment = require("moment");
const request = require("supertest");
const app = require("../app");
const CashSession = require("../models/cashSession");
const WaitlistEntry = require("../models/waitlistEntry");
const {
  createPaymentCommerceFixture,
  createCapturedPaymentForFixture,
  assignPrimaryServiceToStaff,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

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
    today = moment().format("YYYY-MM-DD");
    const stuckAppointmentStart = moment().subtract(90, "minutes");

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

    await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: fixture.client._id,
        serviceId: fixture.service._id,
        staffId: fixture.staff._id,
        date: today,
        startTime: queueStartTime,
      });

    await request(app)
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
      openedAt: new Date(),
      openedBy: fixture.owner._id,
    });

    const payment = await createCapturedPaymentForFixture(fixture, checkout, {
      method: "cash",
      amount: 40,
      tip: 5,
      capturedAt: new Date(),
    });

    payment.cashSession = cashSession._id;
    await payment.save();

    const res = await request(app)
      .get("/business/operational-dashboard")
      .set("Authorization", `Bearer ${token}`)
      .query({
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
    expect(res.body.data.commerceToday.grossCaptured).toBe(40);
    expect(res.body.data.commerceToday.netCaptured).toBe(40);
    expect(res.body.data.commerceToday.transactionCount).toBe(1);
    expect(res.body.data.commerceToday.staffBreakdown).toHaveLength(1);
    expect(res.body.data.commerceToday.staffBreakdown[0].grossCaptured).toBe(40);
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
});
