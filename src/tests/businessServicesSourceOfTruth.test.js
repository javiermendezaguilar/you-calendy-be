const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "mysecretcalendy";
process.env.MONGO_URI = "mock-uri";
process.env.FRONTEND_URL = "https://groomnest.com";
process.env.ADDITIONAL_ALLOWED_ORIGINS = "https://staging.groomnest.com";

jest.setTimeout(30000);

const app = require("../app");
const User = require("../models/User/user");
const Business = require("../models/User/business");
const Service = require("../models/service");
const Staff = require("../models/staff");
const Client = require("../models/client");
const Appointment = require("../models/appointment");
const CapacityLock = require("../models/capacityLock");

let mongoServer;
const externalMongoUri = process.env.TEST_MONGO_URI || "";

beforeAll(async () => {
  let uri = externalMongoUri;
  if (!uri) {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = mongoServer.getUri();
  }
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

describe("Business services source of truth", () => {
  let owner;
  let business;
  let token;

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Business.deleteMany({}),
      Service.deleteMany({}),
      Staff.deleteMany({}),
      Client.deleteMany({}),
      Appointment.deleteMany({}),
      CapacityLock.deleteMany({}),
    ]);

    owner = await User.create({
      name: "Owner",
      firstName: "Owner",
      lastName: "One",
      email: "owner-services@example.com",
      password: "password123",
      role: "barber",
      isEmailVerified: true,
    });

    business = await Business.create({
      owner: owner._id,
      name: "Test Services Barbershop",
      contactInfo: { phone: "+34111111111" },
      services: [
        {
          name: "Legacy Cut",
          type: "Barber",
          price: 18,
          currency: "EUR",
          category: "Cuts",
          isFromEnabled: true,
        },
      ],
    });

    token = jwt.sign({ id: owner._id, role: "barber" }, process.env.JWT_SECRET);
  });

  test("bootstraps canonical services from embedded legacy services and keeps shadow synced", async () => {
    const listRes = await request(app)
      .get("/business/services")
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].name).toBe("Legacy Cut");

    const canonicalAfterBootstrap = await Service.find({
      business: business._id,
    }).lean();
    expect(canonicalAfterBootstrap).toHaveLength(1);
    expect(canonicalAfterBootstrap[0].name).toBe("Legacy Cut");

    const createRes = await request(app)
      .post("/business/services")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Fade Premium",
        type: "Barber",
        price: 25,
        currency: "EUR",
        category: "Premium",
        isFromEnabled: false,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.name).toBe("Fade Premium");

    const servicesAfterCreate = await Service.find({ business: business._id })
      .sort({ createdAt: 1 })
      .lean();
    expect(servicesAfterCreate).toHaveLength(2);

    const createdServiceId = createRes.body.data._id;

    const updateRes = await request(app)
      .put(`/business/services/${createdServiceId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Fade Premium Updated",
        price: 27,
        currency: "EUR",
        category: "Premium",
        isFromEnabled: true,
        isActive: true,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.name).toBe("Fade Premium Updated");
    expect(updateRes.body.data.price).toBe(27);

    const deleteRes = await request(app)
      .delete(`/business/services/${createdServiceId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(deleteRes.status).toBe(200);

    const finalServices = await Service.find({ business: business._id }).lean();
    expect(finalServices).toHaveLength(1);
    expect(finalServices[0].name).toBe("Legacy Cut");

    const refreshedBusiness = await Business.findById(business._id).lean();
    expect(refreshedBusiness.services).toHaveLength(1);
    expect(refreshedBusiness.services[0].name).toBe("Legacy Cut");
  });

  test("legacy service write routes keep business shadow synced and require auth for delete", async () => {
    const canonicalService = await Service.create({
      business: business._id,
      name: "Classic Cut",
      type: "Barber",
      price: 20,
      currency: "EUR",
      category: "Cuts",
      isActive: true,
    });

    business.services = [
      {
        _id: canonicalService._id,
        name: "Classic Cut",
        type: "Barber",
        price: 20,
        currency: "EUR",
        isFromEnabled: false,
      },
    ];
    await business.save();

    const updateRes = await request(app)
      .put(`/services/${canonicalService._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Classic Cut Updated",
        price: 22,
        currency: "EUR",
        category: "Cuts",
        isActive: true,
      });

    expect(updateRes.status).toBe(200);

    let refreshedBusiness = await Business.findById(business._id).lean();
    expect(refreshedBusiness.services).toHaveLength(1);
    expect(refreshedBusiness.services[0].name).toBe("Classic Cut Updated");
    expect(refreshedBusiness.services[0].price).toBe(22);

    const unauthDeleteRes = await request(app)
      .delete(`/services/${canonicalService._id}`)
      .send({ reason: "auth check" });

    expect(unauthDeleteRes.status).toBe(401);

    const deleteRes = await request(app)
      .delete(`/services/${canonicalService._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "duplicate test service" });

    expect(deleteRes.status).toBe(200);

    refreshedBusiness = await Business.findById(business._id).lean();
    expect(refreshedBusiness.services).toHaveLength(0);
  });

  test("booking and availability resolve canonical service when business shadow is empty", async () => {
    const canonicalService = await Service.create({
      business: business._id,
      name: "Canonical Fade",
      type: "Barber",
      price: 30,
      currency: "EUR",
      duration: 45,
      category: "Cuts",
      isActive: true,
    });

    business.services = [];
    await business.save();

    const staff = await Staff.create({
      business: business._id,
      firstName: "Alex",
      lastName: "Fade",
      email: "alex.services@example.com",
      availableForBooking: true,
      services: [{ service: canonicalService._id, timeInterval: 45 }],
      workingHours: [
        {
          day: "monday",
          enabled: true,
          shifts: [{ start: "09:00", end: "12:00", breaks: [] }],
        },
      ],
    });

    const client = await Client.create({
      business: business._id,
      firstName: "Client",
      lastName: "One",
      phone: "+34666666666",
    });

    const availabilityRes = await request(app)
      .get("/appointments/available")
      .query({
        businessId: business._id.toString(),
        serviceId: canonicalService._id.toString(),
        staffId: staff._id.toString(),
        date: "2026-05-18",
      });

    expect(availabilityRes.status).toBe(200);
    expect(availabilityRes.body.data.availableSlots).toContain("09:00");

    const bookingRes = await request(app)
      .post("/appointments/barber")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: canonicalService._id,
        staffId: staff._id,
        date: "2026-05-18",
        startTime: "09:00",
        price: 30,
      });

    expect(bookingRes.status).toBe(201);
    expect(bookingRes.body.data.service._id.toString()).toBe(
      canonicalService._id.toString()
    );

    const createdAppointment = await Appointment.findOne({
      business: business._id,
      service: canonicalService._id,
    }).lean();
    expect(createdAppointment).toBeTruthy();
  });
});
