const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const Client = require("../models/client");
const DomainEvent = require("../models/domainEvent");
const {
  createOperationalCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");
const { futureDateOnly } = require("./helpers/dateTestHelpers");

setupCommerceTestSuite();

describe("Walk-ins v1", () => {
  let business;
  let client;
  let service;
  let staff;
  let token;

  beforeEach(async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerName: "Walkin Owner",
      ownerEmail: "walkin-owner@example.com",
      businessName: "Walkin Shop",
    }, {
      staffTimeInterval: 30,
    });

    business = fixture.business;
    client = fixture.client;
    service = fixture.service;
    staff = fixture.staff;
    token = fixture.token;

    await Appointment.deleteMany({});
  });

  test("creates a walk-in for an existing client and marks it checked in", async () => {
    const walkInDate = futureDateOnly(7);

    const res = await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: walkInDate,
        startTime: "11:00",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.visitType).toBe("walk_in");
    expect(res.body.data.visitStatus).toBe("checked_in");
    expect(res.body.data.bookingStatus).toBe("confirmed");
    expect(res.body.data.queueStatus).toBe("waiting");
    expect(res.body.data.queueEnteredAt).toBeTruthy();
    expect(res.body.data.paymentStatus).toBe("Pending");
    expect(res.body.data.operationalTimestamps.checkedInAt).toBeTruthy();

    const stored = await Appointment.findById(res.body.data._id).lean();
    const event = await DomainEvent.findOne({
      type: "walkin_created",
      correlationId: res.body.data._id.toString(),
    }).lean();
    expect(stored.visitType).toBe("walk_in");
    expect(stored.visitStatus).toBe("checked_in");
    expect(stored.queueStatus).toBe("waiting");
    expect(stored.queueEnteredAt).not.toBeNull();
    expect(stored.operationalTimestamps.checkedInAt).not.toBeNull();
    expect(event).not.toBeNull();
  });

  test("creates or reuses an unregistered client when clientId is not provided", async () => {
    const walkInDate = futureDateOnly(8);

    const res = await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Walk",
        lastName: "In",
        phone: "+34911111111",
        serviceId: service._id,
        staffId: staff._id,
        date: walkInDate,
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
    const walkInDate = futureDateOnly(9);

    await Appointment.create({
      client: client._id,
      business: business._id,
      service: service._id,
      staff: staff._id,
      date: new Date(`${walkInDate}T00:00:00.000Z`),
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
        date: walkInDate,
        startTime: "11:15",
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/not available/i);
  });
});
