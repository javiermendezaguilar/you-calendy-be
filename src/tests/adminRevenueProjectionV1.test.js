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
  buildAppointmentPayload,
  buildCheckoutForAppointment,
  buildCommercePaymentPayload,
  createProjectionAppointments,
  createProjectionPayments,
  createPlatformBillingPayment,
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

    fixture.appointment.date = new Date("2026-04-19T00:00:00.000Z");
    fixture.appointment.status = "Completed";
    fixture.appointment.visitStatus = "completed";
    fixture.appointment.price = 999;
    await fixture.appointment.save();

    const appointments = await createProjectionAppointments(fixture, [
      ["dayOneCompleted", { price: 888, paymentStatus: "Partially Refunded" }],
      [
        "dayTwoRefunded",
        {
          date: new Date("2026-04-20T00:00:00.000Z"),
          price: 777,
          paymentStatus: "Refunded",
        },
      ],
      [
        "dayTwoVoided",
        {
          date: new Date("2026-04-20T00:00:00.000Z"),
          startTime: "12:00",
          endTime: "12:45",
          price: 666,
        },
      ],
      [
        "dayTwoCanceled",
        {
          date: new Date("2026-04-20T00:00:00.000Z"),
          startTime: "14:00",
          endTime: "14:45",
          status: "Canceled",
          bookingStatus: "cancelled",
          visitStatus: "cancelled",
          price: 555,
        },
      ],
      [
        "dayTwoNoShow",
        {
          date: new Date("2026-04-20T00:00:00.000Z"),
          startTime: "16:00",
          endTime: "16:45",
          status: "No-Show",
          visitStatus: "no_show",
          price: 444,
        },
      ],
    ]);

    const checkouts = await Promise.all([
      buildCheckoutForAppointment(fixture, fixture.appointment, {
        total: 40,
        sourcePrice: 999,
      }),
      buildCheckoutForAppointment(fixture, appointments.dayOneCompleted, {
        total: 50,
        sourcePrice: 888,
      }),
      buildCheckoutForAppointment(fixture, appointments.dayTwoRefunded, {
        status: "closed",
        total: 25,
        sourcePrice: 777,
      }),
      buildCheckoutForAppointment(fixture, appointments.dayTwoVoided, {
        status: "closed",
        total: 30,
        sourcePrice: 666,
      }),
    ]);

    await createProjectionPayments(fixture, [
      {
        appointment: fixture.appointment,
        checkout: checkouts[0],
        overrides: {
          status: "captured",
          method: "cash",
          amount: 40,
          reference: "projection-captured",
          capturedAt: new Date("2026-04-19T09:10:00.000Z"),
          sourcePrice: 999,
        },
      },
      {
        appointment: appointments.dayOneCompleted,
        checkout: checkouts[1],
        overrides: {
          status: "refunded_partial",
          method: "card_manual",
          amount: 50,
          reference: "projection-refunded-partial",
          capturedAt: new Date("2026-04-19T10:10:00.000Z"),
          refundedTotal: 10,
          sourcePrice: 888,
        },
      },
      {
        appointment: appointments.dayTwoRefunded,
        checkout: checkouts[2],
        overrides: {
          status: "refunded_full",
          amount: 25,
          reference: "projection-refunded-full",
          capturedAt: new Date("2026-04-20T09:10:00.000Z"),
          refundedTotal: 25,
          sourcePrice: 777,
        },
      },
      {
        appointment: appointments.dayTwoVoided,
        checkout: checkouts[3],
        overrides: {
          status: "voided",
          amount: 30,
          reference: "projection-voided",
          capturedAt: new Date("2026-04-20T10:10:00.000Z"),
          sourcePrice: 666,
        },
      },
    ]);

    await createPlatformBillingPayment(fixture);
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
});
