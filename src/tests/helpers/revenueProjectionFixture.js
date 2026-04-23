const Appointment = require("../../models/appointment");
const Checkout = require("../../models/checkout");
const Payment = require("../../models/payment");

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

const buildCheckoutForAppointment = async (fixture, appointment, overrides = {}) =>
  Checkout.create({
    appointment: appointment._id,
    business: fixture.business._id,
    client: appointment.client,
    staff: appointment.staff,
    status: overrides.status || "paid",
    currency: "EUR",
    subtotal: overrides.subtotal ?? 40,
    discountTotal: 0,
    tip: 0,
    total: overrides.total ?? 40,
    sourcePrice: overrides.sourcePrice ?? appointment.price,
    snapshot: {
      appointmentStatus: appointment.status,
      bookingStatus: appointment.bookingStatus,
      visitStatus: appointment.visitStatus,
      service: { id: fixture.service._id, name: fixture.service.name },
      client: {
        id: appointment.client,
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

const buildPaymentSnapshot = (fixture, appointment, overrides = {}) => {
  const amount = Number(overrides.amount ?? 40) || 0;
  return {
    subtotal: amount,
    discountTotal: 0,
    total: amount,
    sourcePrice: Number(overrides.sourcePrice ?? appointment.price) || 0,
    service: { id: fixture.service._id, name: fixture.service.name },
    client: {
      id: appointment.client,
      firstName: fixture.client.firstName,
      lastName: fixture.client.lastName,
    },
    discounts: { promotionAmount: 0, flashSaleAmount: 0 },
  };
};

const buildCommercePaymentPayload = (
  fixture,
  appointment,
  checkout,
  overrides = {}
) => ({
  paymentScope: "commerce_checkout",
  checkout: checkout._id,
  appointment: appointment._id,
  business: fixture.business._id,
  client: appointment.client,
  staff: appointment.staff,
  status: "captured",
  method: "other",
  currency: "EUR",
  amount: 40,
  tip: 0,
  reference: "projection-payment",
  capturedAt: new Date("2026-04-19T09:10:00.000Z"),
  capturedBy: fixture.owner._id,
  refundedTotal: 0,
  snapshot: buildPaymentSnapshot(fixture, appointment, overrides),
  ...overrides,
});

const createProjectionAppointments = async (fixture, entries) => {
  const createdAppointments = await Promise.all(
    entries.map(([, overrides]) => Appointment.create(buildAppointmentPayload(fixture, overrides)))
  );

  return entries.reduce(
    (acc, [key], index) => ({ ...acc, [key]: createdAppointments[index] }),
    {}
  );
};

const createProjectionPayments = async (fixture, paymentEntries) => {
  return Payment.create(
    paymentEntries.map(({ appointment, checkout, overrides }) =>
      buildCommercePaymentPayload(fixture, appointment, checkout, overrides)
    )
  );
};

const createPlatformBillingPayment = async (fixture, overrides = {}) =>
  Payment.create({
    paymentScope: "platform_billing",
    business: fixture.business._id,
    status: "captured",
    method: "stripe",
    provider: "stripe",
    providerReference: overrides.providerReference || "invoice:projection-platform",
    providerEventId: overrides.providerEventId || "evt_projection_platform",
    providerCustomerId:
      overrides.providerCustomerId || "cus_projection_platform",
    providerSubscriptionId:
      overrides.providerSubscriptionId || "sub_projection_platform",
    currency: "EUR",
    amount: overrides.amount ?? 99,
    tip: 0,
    reference: overrides.reference || "projection-platform",
    capturedAt: overrides.capturedAt || new Date("2026-04-19T12:10:00.000Z"),
    capturedBy: fixture.owner._id,
    snapshot: {
      subtotal: overrides.amount ?? 99,
      discountTotal: 0,
      total: overrides.amount ?? 99,
      sourcePrice: overrides.amount ?? 99,
      service: { id: null, name: "" },
      client: { id: null, firstName: "", lastName: "" },
      discounts: { promotionAmount: 0, flashSaleAmount: 0 },
    },
  });

const seedCanonicalRevenueScenario = async (
  fixture,
  { includeCanceled = true, includeNoShow = true } = {}
) => {
  fixture.appointment.date = new Date("2026-04-19T00:00:00.000Z");
  fixture.appointment.status = "Completed";
  fixture.appointment.visitStatus = "completed";
  fixture.appointment.price = 999;
  await fixture.appointment.save();

  const appointmentEntries = [
    ["dayOneCompleted", { price: 888, paymentStatus: "Partially Refunded" }],
    [
      "dayTwoRefunded",
      {
        date: new Date("2026-04-20T00:00:00.000Z"),
        startTime: "12:00",
        endTime: "12:45",
        price: 777,
        paymentStatus: "Refunded",
      },
    ],
    [
      "dayTwoVoided",
      {
        date: new Date("2026-04-20T00:00:00.000Z"),
        startTime: "14:00",
        endTime: "14:45",
        price: 666,
      },
    ],
  ];

  if (includeCanceled) {
    appointmentEntries.push([
      "dayTwoCanceled",
      {
        date: new Date("2026-04-20T00:00:00.000Z"),
        startTime: "16:00",
        endTime: "16:45",
        status: "Canceled",
        bookingStatus: "cancelled",
        visitStatus: "cancelled",
        price: 555,
      },
    ]);
  }

  if (includeNoShow) {
    appointmentEntries.push([
      "dayTwoNoShow",
      {
        date: new Date("2026-04-20T00:00:00.000Z"),
        startTime: "18:00",
        endTime: "18:45",
        status: "No-Show",
        visitStatus: "no_show",
        price: 444,
      },
    ]);
  }

  const appointments = await createProjectionAppointments(fixture, appointmentEntries);

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

  return {
    appointments,
    appointmentCount: 1 + appointmentEntries.length,
  };
};

module.exports = {
  noPromotionState,
  buildAppointmentPayload,
  buildCheckoutForAppointment,
  buildCommercePaymentPayload,
  createProjectionAppointments,
  createProjectionPayments,
  createPlatformBillingPayment,
  seedCanonicalRevenueScenario,
};
