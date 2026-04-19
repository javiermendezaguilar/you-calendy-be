const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const Service = require("../models/service");
const Staff = require("../models/staff");
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

describe("Walk-ins queue v2", () => {
  let business;
  let client;
  let service;
  let secondService;
  let staff;
  let secondStaff;
  let token;

  beforeEach(async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Queue Owner",
      ownerEmail: "queue-owner@example.com",
      businessName: "Queue Shop",
      appointmentStatus: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "not_started",
      paymentStatus: "Pending",
    });

    business = fixture.business;
    client = fixture.client;
    service = fixture.service;
    staff = fixture.staff;
    token = fixture.token;

    secondService = await Service.create({
      business: business._id,
      name: "Beard Sculpt",
      price: 30,
      currency: "EUR",
      duration: 45,
    });
    secondStaff = await Staff.create({
      business: business._id,
      firstName: "Sam",
      lastName: "Clipper",
    });

    staff.services = [{ service: service._id, timeInterval: 30 }];
    secondStaff.services = [{ service: secondService._id, timeInterval: 45 }];
    await staff.save();
    await secondStaff.save();

    await Appointment.deleteMany({});
  });

  test("persists queue metadata when creating walk-ins", async () => {
    const firstRes = await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-12",
        startTime: "10:00",
      });

    expect(firstRes.status).toBe(201);
    expect(firstRes.body.data.queuePosition).toBe(1);
    expect(firstRes.body.data.estimatedWaitMinutes).toBe(0);

    const secondRes = await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-12",
        startTime: "10:30",
      });

    expect(secondRes.status).toBe(201);
    expect(secondRes.body.data.queuePosition).toBe(2);
    expect(secondRes.body.data.estimatedWaitMinutes).toBe(30);
  });

  test("returns an ordered live queue with per-staff wait estimates", async () => {
    await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-12",
        startTime: "10:00",
      });

    await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: secondService._id,
        staffId: secondStaff._id,
        date: "2026-05-12",
        startTime: "10:00",
      });

    await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-12",
        startTime: "10:30",
      });

    const queueRes = await request(app)
      .get("/business/walk-ins/queue")
      .set("Authorization", `Bearer ${token}`);

    expect(queueRes.status).toBe(200);
    expect(queueRes.body.data).toHaveLength(3);
    expect(queueRes.body.data.map((item) => item.queuePosition)).toEqual([1, 2, 3]);
    expect(queueRes.body.data.map((item) => item.estimatedWaitMinutes)).toEqual([0, 0, 30]);
  });

  test("recalculates queue after an earlier walk-in is completed", async () => {
    const firstRes = await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-12",
        startTime: "10:00",
      });

    await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-12",
        startTime: "10:30",
      });

    await Appointment.findByIdAndUpdate(firstRes.body.data._id, {
      status: "Completed",
      visitStatus: "completed",
    });

    const queueRes = await request(app)
      .get("/business/walk-ins/queue")
      .set("Authorization", `Bearer ${token}`);

    expect(queueRes.status).toBe(200);
    expect(queueRes.body.data).toHaveLength(1);
    expect(queueRes.body.data[0].queuePosition).toBe(1);
    expect(queueRes.body.data[0].estimatedWaitMinutes).toBe(0);

    const stored = await Appointment.findById(queueRes.body.data[0]._id).lean();
    expect(stored.queuePosition).toBe(1);
    expect(stored.estimatedWaitMinutes).toBe(0);
  });
});
