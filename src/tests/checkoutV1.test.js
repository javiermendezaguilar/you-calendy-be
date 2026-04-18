const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "mysecretcalendy";
process.env.MONGO_URI = "mock-uri";
process.env.FRONTEND_URL = "https://groomnest.com";
process.env.ADDITIONAL_ALLOWED_ORIGINS = "https://staging.groomnest.com";

const app = require("../app");
const User = require("../models/User/user");
const Business = require("../models/User/business");
const Client = require("../models/client");
const Service = require("../models/service");
const Staff = require("../models/staff");
const Appointment = require("../models/appointment");
const Checkout = require("../models/checkout");

let mongoServer;

beforeAll(async () => {
  mongoose.set("strictQuery", true);
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

describe("Checkout v1", () => {
  let owner;
  let business;
  let client;
  let service;
  let staff;
  let appointment;
  let token;

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Business.deleteMany({}),
      Client.deleteMany({}),
      Service.deleteMany({}),
      Staff.deleteMany({}),
      Appointment.deleteMany({}),
      Checkout.deleteMany({}),
    ]);

    owner = await User.create({
      name: "Checkout Owner",
      email: "checkout-owner@example.com",
      password: "password123",
      role: "barber",
      isActive: true,
    });

    business = await Business.create({
      owner: owner._id,
      name: "Checkout Shop",
      contactInfo: { phone: "+34111111111" },
    });

    service = await Service.create({
      business: business._id,
      name: "Signature Cut",
      price: 50,
      currency: "EUR",
      duration: 45,
    });

    staff = await Staff.create({
      business: business._id,
      firstName: "Alex",
      lastName: "Fade",
    });

    client = await Client.create({
      business: business._id,
      firstName: "John",
      lastName: "Doe",
      phone: "+34666666666",
    });

    appointment = await Appointment.create({
      client: client._id,
      business: business._id,
      service: service._id,
      staff: staff._id,
      date: new Date("2026-04-18T10:00:00.000Z"),
      startTime: "10:00",
      endTime: "10:45",
      duration: 45,
      status: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "completed",
      visitType: "appointment",
      price: 35,
      promotion: {
        applied: true,
        discountAmount: 10,
        discountPercentage: 20,
        originalPrice: 50,
      },
      flashSale: {
        applied: true,
        discountAmount: 5,
        discountPercentage: 12,
        originalPrice: 40,
      },
    });

    token = jwt.sign({ id: owner._id, role: "barber" }, process.env.JWT_SECRET);
  });

  test("opens a checkout from an appointment and persists audited amounts", async () => {
    const openRes = await request(app)
      .post(`/checkout/appointment/${appointment._id}/open`)
      .set("Authorization", `Bearer ${token}`);

    expect(openRes.status).toBe(201);
    expect(openRes.body.data.status).toBe("open");
    expect(openRes.body.data.subtotal).toBe(35);
    expect(openRes.body.data.discountTotal).toBe(15);
    expect(openRes.body.data.total).toBe(35);
    expect(openRes.body.data.sourcePrice).toBe(50);
    expect(openRes.body.data.snapshot.service.name).toBe("Signature Cut");
    expect(openRes.body.data.snapshot.client.firstName).toBe("John");

    const storedCheckout = await Checkout.findOne({
      appointment: appointment._id,
    }).lean();
    expect(storedCheckout).not.toBeNull();
    expect(storedCheckout.currency).toBe("EUR");
    expect(storedCheckout.snapshot.discounts.promotion.amount).toBe(10);
    expect(storedCheckout.snapshot.discounts.flashSale.amount).toBe(5);
  });

  test("rejects a duplicate open checkout for the same appointment", async () => {
    const firstOpenRes = await request(app)
      .post(`/checkout/appointment/${appointment._id}/open`)
      .set("Authorization", `Bearer ${token}`);

    expect(firstOpenRes.status).toBe(201);

    const duplicateRes = await request(app)
      .post(`/checkout/appointment/${appointment._id}/open`)
      .set("Authorization", `Bearer ${token}`);

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.message).toMatch(/open checkout already exists/i);
  });

  test("closes a checkout with tip and allows reading it by appointment", async () => {
    const openRes = await request(app)
      .post(`/checkout/appointment/${appointment._id}/open`)
      .set("Authorization", `Bearer ${token}`);

    const checkoutId = openRes.body.data._id;

    const closeRes = await request(app)
      .post(`/checkout/${checkoutId}/close`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tip: 7 });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe("closed");
    expect(closeRes.body.data.tip).toBe(7);
    expect(closeRes.body.data.total).toBe(42);
    expect(closeRes.body.data.closedBy.email).toBe("checkout-owner@example.com");

    const byAppointmentRes = await request(app)
      .get(`/checkout/appointment/${appointment._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(byAppointmentRes.status).toBe(200);
    expect(byAppointmentRes.body.data._id).toBe(checkoutId);
    expect(byAppointmentRes.body.data.status).toBe("closed");
  });
});
