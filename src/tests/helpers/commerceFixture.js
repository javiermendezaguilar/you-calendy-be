const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "mysecretcalendy";
process.env.MONGO_URI = "mock-uri";
process.env.FRONTEND_URL = "https://groomnest.com";
process.env.ADDITIONAL_ALLOWED_ORIGINS = "https://staging.groomnest.com";

const User = require("../../models/User/user");
const Business = require("../../models/User/business");
const Client = require("../../models/client");
const Service = require("../../models/service");
const Staff = require("../../models/staff");
const Appointment = require("../../models/appointment");
const Checkout = require("../../models/checkout");
const Payment = require("../../models/payment");
const WaitlistEntry = require("../../models/waitlistEntry");
const CashSession = require("../../models/cashSession");
const Refund = require("../../models/refund");
const DomainEvent = require("../../models/domainEvent");

let mongoServer;
let mongoServerUri;
let stopTimer = null;

const createNoPromotionState = () => ({
  applied: false,
  discountAmount: 0,
  discountPercentage: 0,
  originalPrice: 0,
});

const stopCommerceTestServer = async () => {
  if (!mongoServer) {
    return;
  }

  await mongoose.disconnect();
  await mongoServer.stop();
  mongoServer = null;
  mongoServerUri = null;
};

const connectCommerceTestDatabase = async () => {
  mongoose.set("strictQuery", true);
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }

  if (!mongoServer) {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    mongoServerUri = mongoServer.getUri();
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(mongoServerUri);
};

const disconnectCommerceTestDatabase = async () => {
  await mongoose.disconnect();
  stopTimer = setTimeout(() => {
    stopCommerceTestServer().catch(() => {});
  }, 1000);
};

const resetCommerceCollections = async () => {
  await Promise.all([
    User.deleteMany({}),
    Business.deleteMany({}),
    Client.deleteMany({}),
    Service.deleteMany({}),
    Staff.deleteMany({}),
    Appointment.deleteMany({}),
    Checkout.deleteMany({}),
    Payment.deleteMany({}),
    Refund.deleteMany({}),
    WaitlistEntry.deleteMany({}),
    CashSession.deleteMany({}),
    DomainEvent.deleteMany({}),
  ]);
};

const createCommerceFixture = async (overrides = {}) => {
  await resetCommerceCollections();

  const owner = await User.create({
    name: overrides.ownerName || "Commerce Owner",
    email: overrides.ownerEmail || "commerce-owner@example.com",
    password: "password123",
    role: "barber",
    isActive: true,
  });

  const business = await Business.create({
    owner: owner._id,
    name: overrides.businessName || "Commerce Shop",
    contactInfo: { phone: "+34111111111" },
    bookingBuffer: overrides.bookingBuffer ?? 30,
    penaltySettings: overrides.penaltySettings || {
      noShowPenalty: false,
      noShowPenaltyAmount: 0,
    },
  });

  const service = await Service.create({
    business: business._id,
    name: overrides.serviceName || "Signature Cut",
    price: overrides.servicePrice ?? 50,
    currency: overrides.currency || "EUR",
    duration: overrides.duration ?? 45,
  });

  const staff = await Staff.create({
    business: business._id,
    firstName: overrides.staffFirstName || "Alex",
    lastName: overrides.staffLastName || "Fade",
    email: overrides.staffEmail || "alex.fade@example.com",
  });

  const client = await Client.create({
    business: business._id,
    firstName: "John",
    lastName: "Doe",
    phone: "+34666666666",
  });

  const appointment = await Appointment.create({
    client: client._id,
    business: business._id,
    service: service._id,
    staff: staff._id,
    date: new Date("2026-04-18T10:00:00.000Z"),
    startTime: "10:00",
    endTime: "10:45",
    duration: 45,
    status: overrides.appointmentStatus || "Confirmed",
    bookingStatus: overrides.bookingStatus || "confirmed",
    visitStatus: overrides.visitStatus || "completed",
    visitType: "appointment",
    paymentStatus: overrides.paymentStatus || "Pending",
    price: overrides.appointmentPrice ?? 35,
    policySnapshot:
      overrides.policySnapshot || Appointment.buildPolicySnapshot(business),
    promotion: overrides.promotion || {
      applied: true,
      discountAmount: 10,
      discountPercentage: 20,
      originalPrice: 50,
    },
    flashSale: overrides.flashSale || {
      applied: true,
      discountAmount: 5,
      discountPercentage: 12,
      originalPrice: 40,
    },
  });

  const token = jwt.sign(
    { id: owner._id, role: "barber" },
    process.env.JWT_SECRET
  );

  return {
    owner,
    business,
    client,
    service,
    staff,
    appointment,
    token,
  };
};

const assignPrimaryServiceToStaff = async (staff, service, timeInterval = 45) => {
  staff.services = [{ service: service._id, timeInterval }];
  await staff.save();
  return staff;
};

const syncPrimaryServiceOnBusiness = async (business, service) => {
  business.services = [
    {
      _id: service._id,
      name: service.name,
      type: "Barber",
      price: service.price,
      currency: service.currency,
    },
  ];
  await business.save();
  return business;
};

const createOperationalCommerceFixture = async (
  overrides = {},
  options = {}
) => {
  const fixture = await createCommerceFixture({
    appointmentStatus: "Confirmed",
    bookingStatus: "confirmed",
    visitStatus: "not_started",
    paymentStatus: "Pending",
    promotion: createNoPromotionState(),
    flashSale: createNoPromotionState(),
    ...overrides,
  });

  if (options.staffTimeInterval) {
    await assignPrimaryServiceToStaff(
      fixture.staff,
      fixture.service,
      options.staffTimeInterval
    );
  }

  if (options.syncBusinessServices) {
    await syncPrimaryServiceOnBusiness(fixture.business, fixture.service);
  }

  return fixture;
};

const createClosedCheckoutForFixture = async (fixture, overrides = {}) => {
  return Checkout.create({
    appointment: fixture.appointment._id,
    business: fixture.business._id,
    client: fixture.client._id,
    staff: fixture.staff._id,
    status: "closed",
    currency: overrides.currency || "EUR",
    subtotal: overrides.subtotal ?? 35,
    discountTotal: overrides.discountTotal ?? 0,
    tip: overrides.tip ?? 5,
    total: overrides.total ?? 40,
    sourcePrice: overrides.sourcePrice ?? 35,
    snapshot: overrides.snapshot || {
      appointmentStatus: fixture.appointment.status,
      bookingStatus: fixture.appointment.bookingStatus,
      visitStatus: fixture.appointment.visitStatus,
      service: {
        id: fixture.service._id,
        name: fixture.service.name,
      },
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
    closedAt: overrides.closedAt || new Date(),
    closedBy: overrides.closedBy || fixture.owner._id,
  });
};

const openCashSessionForToken = async (app, token, overrides = {}) => {
  return app
    ? require("supertest")(app)
        .post("/cash-sessions/open")
        .set("Authorization", `Bearer ${token}`)
        .send({
          openingFloat: overrides.openingFloat ?? 50,
          currency: overrides.currency || "EUR",
          openingReason: overrides.openingReason || "manual_start",
          openingNote: overrides.openingNote || "",
          handoffFromSessionId: overrides.handoffFromSessionId || undefined,
        })
    : null;
};

const captureCheckoutPaymentForToken = async (
  app,
  token,
  checkoutId,
  payload = {}
) => {
  return require("supertest")(app)
    .post(`/payment/checkout/${checkoutId}/capture`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      method: payload.method || "cash",
      amount: payload.amount ?? 40,
      reference: payload.reference || "",
    });
};

const createCapturedPaymentForFixture = async (fixture, checkout, overrides = {}) => {
  checkout.status = overrides.checkoutStatus || "paid";
  await checkout.save();

  return Payment.create({
    checkout: checkout._id,
    appointment: fixture.appointment._id,
    business: fixture.business._id,
    client: fixture.client._id,
    staff: fixture.staff._id,
    status: overrides.status || "captured",
    method: overrides.method || "card_manual",
    currency: overrides.currency || "EUR",
    amount: overrides.amount ?? 40,
    tip: overrides.tip ?? 5,
    reference: overrides.reference || "fixture-payment",
    capturedAt: overrides.capturedAt || new Date(),
    capturedBy: overrides.capturedBy || fixture.owner._id,
    snapshot: overrides.snapshot || {
      subtotal: overrides.subtotal ?? 35,
      discountTotal: overrides.discountTotal ?? 0,
      total: overrides.total ?? 40,
      sourcePrice: overrides.sourcePrice ?? 35,
      service: {
        id: fixture.service._id,
        name: fixture.service.name,
      },
      client: {
        id: fixture.client._id,
        firstName: fixture.client.firstName,
        lastName: fixture.client.lastName,
      },
      discounts: {
        promotionAmount: 0,
        flashSaleAmount: 0,
      },
    },
  });
};

const createPaymentCommerceFixture = async (overrides = {}) => {
  const fixture = await createCommerceFixture({
    appointmentStatus: "Completed",
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
    ...overrides,
  });

  const checkout = await createClosedCheckoutForFixture(fixture, {
    subtotal: 35,
    discountTotal: 0,
    tip: 5,
    total: 40,
    sourcePrice: 35,
    ...overrides.checkoutOverrides,
  });

  return {
    fixture,
    appointment: fixture.appointment,
    checkout,
    token: fixture.token,
  };
};

module.exports = {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
  createOperationalCommerceFixture,
  createClosedCheckoutForFixture,
  createPaymentCommerceFixture,
  assignPrimaryServiceToStaff,
  syncPrimaryServiceOnBusiness,
  openCashSessionForToken,
  captureCheckoutPaymentForToken,
  createCapturedPaymentForFixture,
};
