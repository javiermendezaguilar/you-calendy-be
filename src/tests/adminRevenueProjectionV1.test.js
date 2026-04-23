const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const User = require("../models/User/user");
const {
  createCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");
const {
  noPromotionState,
  seedCanonicalRevenueScenario,
} = require("./helpers/revenueProjectionFixture");

setupCommerceTestSuite();

describe("Admin revenue projection v1", () => {
  let fixture;
  let adminToken;

  beforeEach(async () => {
    fixture = await createCommerceFixture({
      ownerName: "Revenue Projection Owner",
      ownerEmail: "revenue-projection-owner@example.com",
      businessName: "Revenue Projection Shop",
      appointmentStatus: "Completed",
      bookingStatus: "confirmed",
      visitStatus: "completed",
      paymentStatus: "Paid",
      appointmentPrice: 999,
      promotion: {
        applied: false,
        discountAmount: 0,
        discountPercentage: 0,
        originalPrice: 0,
      },
      flashSale: {
        applied: false,
        discountAmount: 0,
        discountPercentage: 0,
        originalPrice: 0,
      },
    });

    const admin = await User.create({
      name: "Revenue Admin",
      email: "revenue-admin@example.com",
      password: "password123",
      role: "admin",
      isActive: true,
    });

    adminToken = jwt.sign(
      { id: admin._id, role: "admin" },
      process.env.JWT_SECRET
    );

    await seedCanonicalRevenueScenario(fixture, {
      includeCanceled: true,
      includeNoShow: true,
    });
  });

  test("uses canonical payment revenue while keeping appointment activity stats", async () => {
    const res = await request(app)
      .get("/admin/stats/revenue-projection?startDate=2026-04-19T00:00:00.000Z&endDate=2026-04-20T23:59:59.999Z&groupBy=day")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalRevenue).toBe(80);
    expect(res.body.data.totalAppointments).toBe(6);
    expect(res.body.data.averageRevenuePerAppointment).toBeCloseTo(13.33, 2);
    expect(res.body.data.summary.totalRevenue).toBe(80);
    expect(res.body.data.summary.completionRate).toBe(66.7);
    expect(res.body.data.summary.cancelledRate).toBe(16.7);
    expect(res.body.data.summary.noShowRate).toBe(16.7);

    expect(res.body.data.revenueData).toEqual([
      {
        date: "2026-04-19",
        revenue: 80,
        appointments: 2,
        completedAppointments: 2,
        cancelledAppointments: 0,
        noShowAppointments: 0,
      },
      {
        date: "2026-04-20",
        revenue: 0,
        appointments: 4,
        completedAppointments: 2,
        cancelledAppointments: 1,
        noShowAppointments: 1,
      },
    ]);
  });

  test("uses canonical payment revenue in auth barber list and detail", async () => {
    const otherBarber = await User.create({
      name: "Other Barber",
      email: "other-barber@example.com",
      password: "password123",
      role: "barber",
      isActive: true,
    });

    const listRes = await request(app)
      .get("/auth/barbers?sort=totalRevenue:desc")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.pagination.total).toBeGreaterThanOrEqual(2);

    const ownerEntry = listRes.body.data.barbers.find(
      (barber) => barber._id.toString() === fixture.owner._id.toString()
    );
    const otherEntry = listRes.body.data.barbers.find(
      (barber) => barber._id.toString() === otherBarber._id.toString()
    );

    expect(ownerEntry.totalRevenue).toBe(80);
    expect(ownerEntry.totalAppointments).toBe(6);
    expect(ownerEntry.business.name).toBe("Revenue Projection Shop");
    expect(otherEntry.totalRevenue).toBe(0);
    expect(otherEntry.totalAppointments).toBe(0);
    expect(listRes.body.data.barbers[0]._id.toString()).toBe(
      fixture.owner._id.toString()
    );
    expect(listRes.body.data.semanticScope).toEqual({
      entity: "owner_business_legacy",
      revenue: "business",
      activity: "business",
    });

    const detailRes = await request(app)
      .get(`/auth/barbers/${fixture.owner._id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.totalRevenue).toBe(80);
    expect(detailRes.body.data.totalAppointments).toBe(6);
    expect(detailRes.body.data.business.name).toBe("Revenue Projection Shop");
    expect(detailRes.body.data.semanticScope).toEqual({
      entity: "owner_business_legacy",
      revenue: "business",
      activity: "business",
    });
  });
});
