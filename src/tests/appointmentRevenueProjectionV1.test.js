const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const Client = require("../models/client");
const {
  createCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");
const {
  noPromotionState,
  buildAppointmentPayload,
  buildCheckoutForAppointment,
  createProjectionPayments,
  createPlatformBillingPayment,
} = require("./helpers/revenueProjectionFixture");

setupCommerceTestSuite();

describe("Appointment revenue projection v1", () => {
  test("uses canonical payment revenue for owner projection and excludes platform billing", async () => {
    const fixture = await createCommerceFixture({
      appointmentStatus: "Completed",
      bookingStatus: "confirmed",
      visitStatus: "completed",
      paymentStatus: "Paid",
      appointmentPrice: 999,
      promotion: { ...noPromotionState },
      flashSale: { ...noPromotionState },
    });

    fixture.appointment.date = new Date("2026-04-21T00:00:00.000Z");
    fixture.appointment.price = 999;
    await fixture.appointment.save();

    const secondAppointment = await Appointment.create(
      buildAppointmentPayload(fixture, {
        date: new Date("2026-04-22T00:00:00.000Z"),
        startTime: "11:00",
        endTime: "11:45",
        price: 888,
        paymentStatus: "Partially Refunded",
      })
    );

    const checkoutOne = await buildCheckoutForAppointment(fixture, fixture.appointment, {
      total: 40,
      sourcePrice: 999,
    });
    const checkoutTwo = await buildCheckoutForAppointment(fixture, secondAppointment, {
      total: 50,
      sourcePrice: 888,
    });

    await createProjectionPayments(fixture, [
      {
        appointment: fixture.appointment,
        checkout: checkoutOne,
        overrides: {
          status: "captured",
          method: "cash",
          amount: 40,
          reference: "appointment-owner-captured",
          capturedAt: new Date("2026-04-21T09:10:00.000Z"),
          sourcePrice: 999,
        },
      },
      {
        appointment: secondAppointment,
        checkout: checkoutTwo,
        overrides: {
          status: "refunded_partial",
          method: "card_manual",
          amount: 50,
          reference: "appointment-owner-partial",
          capturedAt: new Date("2026-04-22T09:10:00.000Z"),
          refundedTotal: 10,
          sourcePrice: 888,
        },
      },
    ]);

    await createPlatformBillingPayment(fixture, {
      amount: 77,
      reference: "appointment-owner-platform",
      providerReference: "invoice:appointment-owner-platform",
      providerEventId: "evt_appointment_owner_platform",
      providerCustomerId: "cus_appointment_owner_platform",
      providerSubscriptionId: "sub_appointment_owner_platform",
      capturedAt: new Date("2026-04-21T12:10:00.000Z"),
    });

    const res = await request(app)
      .get(
        "/appointments/revenue-projection?startDate=2026-04-21T00:00:00.000Z&endDate=2026-04-22T23:59:59.999Z&groupBy=day"
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalRevenue).toBe(80);
    expect(res.body.data.totalAppointments).toBe(2);
    expect(res.body.data.averageRevenuePerAppointment).toBe(40);
    expect(res.body.data.revenueData).toEqual([
      {
        date: "2026-04-21",
        revenue: 40,
        appointments: 1,
        completedAppointments: 1,
        cancelledAppointments: 0,
        noShowAppointments: 0,
      },
      {
        date: "2026-04-22",
        revenue: 40,
        appointments: 1,
        completedAppointments: 1,
        cancelledAppointments: 0,
        noShowAppointments: 0,
      },
    ]);
  });

  test("limits client projection to the client's own canonical payments", async () => {
    const fixture = await createCommerceFixture({
      appointmentStatus: "Completed",
      bookingStatus: "confirmed",
      visitStatus: "completed",
      paymentStatus: "Paid",
      appointmentPrice: 700,
      promotion: { ...noPromotionState },
      flashSale: { ...noPromotionState },
    });

    fixture.appointment.date = new Date("2026-04-23T00:00:00.000Z");
    fixture.appointment.price = 700;
    await fixture.appointment.save();

    const otherClientAppointment = await Appointment.create(
      buildAppointmentPayload(fixture, {
        date: new Date("2026-04-23T00:00:00.000Z"),
        startTime: "12:00",
        endTime: "12:45",
        client: fixture.client._id,
        price: 600,
      })
    );

    const checkoutOne = await buildCheckoutForAppointment(fixture, fixture.appointment, {
      total: 35,
      sourcePrice: 700,
    });
    const checkoutTwo = await buildCheckoutForAppointment(fixture, otherClientAppointment, {
      total: 25,
      sourcePrice: 600,
    });

    const secondClient = await Client.create({
      business: fixture.business._id,
      firstName: "Other",
      lastName: "Client",
      phone: "+34777777777",
    });

    otherClientAppointment.client = secondClient._id;
    await otherClientAppointment.save();
    checkoutTwo.client = secondClient._id;
    await checkoutTwo.save();

    await createProjectionPayments(fixture, [
      {
        appointment: fixture.appointment,
        checkout: checkoutOne,
        overrides: {
          amount: 35,
          reference: "appointment-client-own",
          capturedAt: new Date("2026-04-23T09:00:00.000Z"),
          sourcePrice: 700,
        },
      },
      {
        appointment: otherClientAppointment,
        checkout: checkoutTwo,
        overrides: {
          amount: 25,
          reference: "appointment-client-other",
          capturedAt: new Date("2026-04-23T10:00:00.000Z"),
          sourcePrice: 600,
        },
      },
    ]);

    const clientToken = jwt.sign(
      {
        id: fixture.client._id,
        role: "client",
        type: "client",
        businessId: fixture.business._id.toString(),
      },
      process.env.JWT_SECRET
    );

    const res = await request(app)
      .get(
        "/appointments/revenue-projection?startDate=2026-04-23T00:00:00.000Z&endDate=2026-04-23T23:59:59.999Z&groupBy=day"
      )
      .set("Authorization", `Bearer ${clientToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalRevenue).toBe(35);
    expect(res.body.data.totalAppointments).toBe(1);
    expect(res.body.data.revenueData).toEqual([
      {
        date: "2026-04-23",
        revenue: 35,
        appointments: 1,
        completedAppointments: 1,
        cancelledAppointments: 0,
        noShowAppointments: 0,
      },
    ]);
  });
});
