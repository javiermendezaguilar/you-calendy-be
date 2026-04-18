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

let mongoServer;

const connectCommerceTestDatabase = async () => {
  mongoose.set("strictQuery", true);
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);
};

const disconnectCommerceTestDatabase = async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
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
    WaitlistEntry.deleteMany({}),
    CashSession.deleteMany({}),
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
    firstName: "Alex",
    lastName: "Fade",
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

module.exports = {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
  createClosedCheckoutForFixture,
  openCashSessionForToken,
  captureCheckoutPaymentForToken,
};
