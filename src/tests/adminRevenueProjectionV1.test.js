const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const User = require("../models/User/user");
const Appointment = require("../models/appointment");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const {
  createCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

const noPromotionState = Object.freeze({
  applied: false,
  discountAmount: 0,
  discountPercentage: 0,
  originalPrice: 0,
});

const buildAppointmentPayload = (fixture, overrides = {}) => ({
  client: fixture.client._id,
  business: fixture.business._id,
  service: fixture.service._id,
  staff: fixture.staff._id,
  date: new Date("2026-04-19T00:00:00.000Z"),
  startTime: "10:00",
  endTime: "10:45",
  duration: 45,
  status: "Completed",
  bookingStatus: "confirmed",
  visitStatus: "completed",
  visitType: "appointment",
  paymentStatus: "Pending",
  price: 100,
  promotion: { ...noPromotionState },
  flashSale: { ...noPromotionState },
  ...overrides,
});

const buildCheckoutForAppointment = async (fixture, appointment, overrides = {}) => {
  return Checkout.create({
    appointment: appointment._id,
    business: fixture.business._id,
    client: fixture.client._id,
    staff: fixture.staff._id,
    status: overrides.status || "paid",
    currency: "EUR",
    subtotal: overrides.subtotal ?? 40,
    discountTotal: 0,
    tip: 0,
    total: overrides.total ?? 40,
    sourcePrice: overrides.sourcePrice ?? 40,
    snapshot: {
      appointmentStatus: appointment.status,
      bookingStatus: appointment.bookingStatus,
      visitStatus: appointment.visitStatus,
      service: { id: fixture.service._id, name: fixture.service.name },
      client: {
        id: fixture.client._id,
        firstName: fixture.client.firstName,
        lastName: fixture.client.lastName,
      },
      discounts: {
        promotion: { applied: false, id: null, amount: 0 },
        flashSale: { applied: false, id: null, amount: 0 },
      },
    },
    openedAt: overrides.openedAt || new Date(),
    closedAt: overrides.closedAt || new Date(),
    closedBy: fixture.owner._id,
  });
};

const buildPaymentSnapshot = (fixture, sourcePrice, total) => ({
  subtotal: total,
  discountTotal: 0,
  total,
  sourcePrice,
  service: { id: fixture.service._id, name: fixture.service.name },
  client: {
    id: fixture.client._id,
    firstName: fixture.client.firstName,
    lastName: fixture.client.lastName,
  },
  discounts: { promotionAmount: 0, flashSaleAmount: 0 },
});

const buildCommercePaymentPayload = (fixture, appointment, checkout, overrides = {}) => ({
  paymentScope: "commerce_checkout",
  checkout: checkout._id,
  appointment: appointment._id,
  business: fixture.business._id,
  client: fixture.client._id,
  staff: fixture.staff._id,
  status: "captured",
  method: "other",
  currency: "EUR",
  amount: 40,
  tip: 0,
  reference: "projection-payment",
  capturedAt: new Date("2026-04-19T09:10:00.000Z"),
  capturedBy: fixture.owner._id,
  refundedTotal: 0,
  snapshot: buildPaymentSnapshot(
    fixture,
    Number(overrides.sourcePrice ?? appointment.price) || 0,
    Number(overrides.amount ?? 40) || 0
  ),
  ...overrides,
});

const createProjectionAppointments = async (fixture) => {
  const appointmentEntries = [
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
  ];

  const createdAppointments = await Promise.all(
    appointmentEntries.map(([, overrides]) =>
      Appointment.create(buildAppointmentPayload(fixture, overrides))
    )
  );

  return appointmentEntries.reduce(
    (acc, [key], index) => ({ ...acc, [key]: createdAppointments[index] }),
    {}
  );
};

const createProjectionPayments = async (fixture, appointments) => {
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

  const paymentEntries = [
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
  ];

  await Payment.create(
    paymentEntries.map(({ appointment, checkout, overrides }) =>
      buildCommercePaymentPayload(fixture, appointment, checkout, overrides)
    )
  );

  return Payment.create({
    paymentScope: "platform_billing",
    business: fixture.business._id,
    status: "captured",
    method: "stripe",
    provider: "stripe",
    providerReference: "invoice:projection-platform",
    providerEventId: "evt_projection_platform",
    providerCustomerId: "cus_projection_platform",
    providerSubscriptionId: "sub_projection_platform",
    currency: "EUR",
    amount: 99,
    tip: 0,
    reference: "projection-platform",
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
};

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

    const appointments = await createProjectionAppointments(fixture);
    await createProjectionPayments(fixture, appointments);
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
