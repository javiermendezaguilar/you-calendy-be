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

module.exports = {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
};
