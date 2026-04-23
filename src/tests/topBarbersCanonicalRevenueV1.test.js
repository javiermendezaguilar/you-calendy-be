const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const User = require("../models/User/user");
const Staff = require("../models/staff");
const Appointment = require("../models/appointment");
const Payment = require("../models/payment");
const Checkout = require("../models/checkout");
const {
  createCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

describe("Top barbers canonical revenue v1", () => {
  test("keeps ranking by completed appointments and adds canonical commerce revenue per staff", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Top Barber Owner",
      ownerEmail: "top-barber-owner@example.com",
      businessName: "Top Barber Shop",
      appointmentStatus: "Completed",
      bookingStatus: "confirmed",
      visitStatus: "completed",
      paymentStatus: "Paid",
      appointmentPrice: 999,
    });

    const admin = await User.create({
      name: "Top Barber Admin",
      email: "top-barber-admin@example.com",
      password: "password123",
      role: "admin",
      isActive: true,
    });
    const adminToken = jwt.sign(
      { id: admin._id, role: "admin" },
      process.env.JWT_SECRET
    );

    const staffTwo = await Staff.create({
      business: fixture.business._id,
      firstName: "Jamie",
      lastName: "Clip",
      email: "jamie.clip@example.com",
    });

    fixture.appointment.staff = fixture.staff._id;
    fixture.appointment.status = "Completed";
    fixture.appointment.date = new Date("2026-06-10T10:00:00.000Z");
    await fixture.appointment.save();

    const appointmentTwo = await Appointment.create({
      client: fixture.client._id,
      business: fixture.business._id,
      service: fixture.service._id,
      staff: fixture.staff._id,
      date: new Date("2026-06-11T10:00:00.000Z"),
      startTime: "10:00",
      endTime: "10:45",
      duration: 45,
      status: "Completed",
      bookingStatus: "confirmed",
      visitStatus: "completed",
      visitType: "appointment",
      paymentStatus: "Paid",
      price: 500,
      policySnapshot: fixture.appointment.policySnapshot,
      promotion: fixture.appointment.promotion,
      flashSale: fixture.appointment.flashSale,
    });

    const appointmentThree = await Appointment.create({
      client: fixture.client._id,
      business: fixture.business._id,
      service: fixture.service._id,
      staff: staffTwo._id,
      date: new Date("2026-06-12T10:00:00.000Z"),
      startTime: "10:00",
      endTime: "10:45",
      duration: 45,
      status: "Completed",
      bookingStatus: "confirmed",
      visitStatus: "completed",
      visitType: "appointment",
      paymentStatus: "Paid",
      price: 500,
      policySnapshot: fixture.appointment.policySnapshot,
      promotion: fixture.appointment.promotion,
      flashSale: fixture.appointment.flashSale,
    });

    const checkoutOne = await Checkout.create({
      appointment: fixture.appointment._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      status: "paid",
      currency: "EUR",
      subtotal: 40,
      discountTotal: 0,
      tip: 0,
      total: 40,
      sourcePrice: 40,
      openedAt: new Date("2026-06-10T10:00:00.000Z"),
    });

    const checkoutTwo = await Checkout.create({
      appointment: appointmentTwo._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: fixture.staff._id,
      status: "paid",
      currency: "EUR",
      subtotal: 35,
      discountTotal: 0,
      tip: 0,
      total: 35,
      sourcePrice: 35,
      openedAt: new Date("2026-06-11T10:00:00.000Z"),
    });

    const checkoutThree = await Checkout.create({
      appointment: appointmentThree._id,
      business: fixture.business._id,
      client: fixture.client._id,
      staff: staffTwo._id,
      status: "paid",
      currency: "EUR",
      subtotal: 60,
      discountTotal: 0,
      tip: 0,
      total: 60,
      sourcePrice: 60,
      openedAt: new Date("2026-06-12T10:00:00.000Z"),
    });

    await Payment.create([
      {
        paymentScope: "commerce_checkout",
        checkout: checkoutOne._id,
        appointment: fixture.appointment._id,
        business: fixture.business._id,
        client: fixture.client._id,
        staff: fixture.staff._id,
        status: "captured",
        method: "cash",
        currency: "EUR",
        amount: 40,
        tip: 0,
        reference: "top-barber-1",
        capturedAt: new Date("2026-06-10T10:30:00.000Z"),
        capturedBy: fixture.owner._id,
      },
      {
        paymentScope: "commerce_checkout",
        checkout: checkoutTwo._id,
        appointment: appointmentTwo._id,
        business: fixture.business._id,
        client: fixture.client._id,
        staff: fixture.staff._id,
        status: "refunded_partial",
        refundedTotal: 5,
        method: "cash",
        currency: "EUR",
        amount: 35,
        tip: 0,
        reference: "top-barber-2",
        capturedAt: new Date("2026-06-11T10:30:00.000Z"),
        capturedBy: fixture.owner._id,
      },
      {
        paymentScope: "commerce_checkout",
        checkout: checkoutThree._id,
        appointment: appointmentThree._id,
        business: fixture.business._id,
        client: fixture.client._id,
        staff: staffTwo._id,
        status: "captured",
        method: "card_manual",
        currency: "EUR",
        amount: 60,
        tip: 0,
        reference: "top-barber-3",
        capturedAt: new Date("2026-06-12T10:30:00.000Z"),
        capturedBy: fixture.owner._id,
      },
      {
        paymentScope: "platform_billing",
        business: fixture.business._id,
        status: "captured",
        method: "stripe",
        provider: "stripe",
        providerReference: "invoice:top-barber-platform",
        providerEventId: "evt_top_barber_platform",
        providerCustomerId: "cus_top_barber_platform",
        providerSubscriptionId: "sub_top_barber_platform",
        currency: "EUR",
        amount: 999,
        tip: 0,
        reference: "top-barber-platform",
        capturedAt: new Date("2026-06-12T11:00:00.000Z"),
        capturedBy: fixture.owner._id,
      },
    ]);

    const res = await request(app)
      .get("/admin/stats/top-barbers?year=2026")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    expect(res.body.data[0]).toMatchObject({
      barberId: fixture.staff._id.toString(),
      completedAppointments: 2,
      commerceRevenue: 70,
      moneyScope: {
        domain: "commerce_checkout",
        owner: "business",
        excludes: ["platform_billing"],
      },
      attributionScope: "staff_individual_canonical",
    });

    expect(res.body.data[1]).toMatchObject({
      barberId: staffTwo._id.toString(),
      completedAppointments: 1,
      commerceRevenue: 60,
      moneyScope: {
        domain: "commerce_checkout",
        owner: "business",
        excludes: ["platform_billing"],
      },
      attributionScope: "staff_individual_canonical",
    });
  });
});
