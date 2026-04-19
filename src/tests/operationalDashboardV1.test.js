const moment = require("moment");
const request = require("supertest");
const app = require("../app");
const CashSession = require("../models/cashSession");
const WaitlistEntry = require("../models/waitlistEntry");
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

    fixture.staff.services = [{ service: fixture.service._id, timeInterval: 30 }];
    await fixture.staff.save();

    await CashSession.deleteMany({});
    await WaitlistEntry.deleteMany({});
  });

  test("returns queue, waitlist, cash session, commerce summary and operational actions", async () => {
    await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: fixture.client._id,
        serviceId: fixture.service._id,
        staffId: fixture.staff._id,
        date: today,
        startTime: moment().add(20, "minutes").format("HH:mm"),
      });

    await request(app)
      .post("/business/waitlist")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: fixture.client._id,
        serviceId: fixture.service._id,
        staffId: fixture.staff._id,
        date: today,
        timeWindowStart: moment().add(15, "minutes").format("HH:mm"),
        timeWindowEnd: moment().add(120, "minutes").format("HH:mm"),
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
        fromTime: moment().format("HH:mm"),
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
    expect(res.body.data.commerceToday.grossCaptured).toBe(40);
    expect(res.body.data.commerceToday.netCaptured).toBe(40);
    expect(res.body.data.commerceToday.transactionCount).toBe(1);
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
