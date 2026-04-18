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
const Service = require("../models/service");

let mongoServer;

beforeAll(async () => {
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

describe("Business services source of truth", () => {
  let owner;
  let business;
  let token;

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Business.deleteMany({}),
      Service.deleteMany({}),
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
});
