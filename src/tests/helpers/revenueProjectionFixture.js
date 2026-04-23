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

module.exports = {
  noPromotionState,
  buildAppointmentPayload,
  buildCheckoutForAppointment,
  buildCommercePaymentPayload,
  createProjectionAppointments,
  createProjectionPayments,
  createPlatformBillingPayment,
};
