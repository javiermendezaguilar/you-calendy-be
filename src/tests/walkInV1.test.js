const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const Client = require("../models/client");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("Walk-ins v1", () => {
  let business;
  let client;
  let service;
  let staff;
  let token;

  beforeEach(async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Walkin Owner",
      ownerEmail: "walkin-owner@example.com",
      businessName: "Walkin Shop",
      appointmentStatus: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "not_started",
      paymentStatus: "Pending",
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

    business = fixture.business;
    client = fixture.client;
    service = fixture.service;
    staff = fixture.staff;
    token = fixture.token;

    staff.services = [{ service: service._id, timeInterval: 30 }];
    await staff.save();

    await Appointment.deleteMany({});
  });

  test("creates a walk-in for an existing client and marks it checked in", async () => {
    const res = await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-03",
        startTime: "11:00",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.visitType).toBe("walk_in");
    expect(res.body.data.visitStatus).toBe("checked_in");
    expect(res.body.data.bookingStatus).toBe("confirmed");
    expect(res.body.data.paymentStatus).toBe("Pending");
    expect(res.body.data.operationalTimestamps.checkedInAt).toBeTruthy();

    const stored = await Appointment.findById(res.body.data._id).lean();
    expect(stored.visitType).toBe("walk_in");
    expect(stored.visitStatus).toBe("checked_in");
    expect(stored.operationalTimestamps.checkedInAt).not.toBeNull();
  });

  test("creates or reuses an unregistered client when clientId is not provided", async () => {
    const res = await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Walk",
        lastName: "In",
        phone: "+34911111111",
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-03",
        startTime: "12:00",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.client.registrationStatus).toBe("unregistered");

    const storedClient = await Client.findOne({
      business: business._id,
      phone: "34911111111",
    }).lean();
    expect(storedClient).not.toBeNull();
    expect(storedClient.registrationStatus).toBe("unregistered");
  });

  test("rejects staff conflicts for walk-ins", async () => {
    await Appointment.create({
      client: client._id,
      business: business._id,
      service: service._id,
      staff: staff._id,
      date: new Date("2026-05-03T00:00:00.000Z"),
      startTime: "11:00",
      endTime: "11:30",
      duration: 30,
      status: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "checked_in",
      visitType: "walk_in",
      paymentStatus: "Pending",
      price: 35,
      operationalTimestamps: {
        checkedInAt: new Date(),
        checkedInBy: client._id,
      },
    });

    const res = await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-03",
        startTime: "11:15",
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/not available/i);
  });
});
