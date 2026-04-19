const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const WaitlistEntry = require("../models/waitlistEntry");
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

describe("Waitlist v2 queue-linked", () => {
  let business;
  let client;
  let service;
  let staff;
  let token;

  beforeEach(async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Waitlist Queue Owner",
      ownerEmail: "waitlist-queue-owner@example.com",
      businessName: "Waitlist Queue Shop",
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

    staff.services = [{ service: service._id, timeInterval: 45 }];
    await staff.save();
    await Appointment.deleteMany({});
    await WaitlistEntry.deleteMany({});
  });

  test("returns fill-gap candidates based on the live queue", async () => {
    await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-14",
        startTime: "10:00",
      });

    await request(app)
      .post("/business/waitlist")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-14",
        timeWindowStart: "10:30",
        timeWindowEnd: "12:00",
        notes: "Fits after queue",
      });

    await request(app)
      .post("/business/waitlist")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-14",
        timeWindowStart: "08:00",
        timeWindowEnd: "09:30",
        notes: "Too early",
      });

    const res = await request(app)
      .get("/business/waitlist/fill-gaps")
      .set("Authorization", `Bearer ${token}`)
      .query({
        serviceId: service._id.toString(),
        staffId: staff._id.toString(),
        date: "2026-05-14",
        fromTime: "10:00",
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].estimatedWaitMinutes).toBe(45);
    expect(res.body.data[0].slotStart).toBe("10:45");
    expect(res.body.data[0].slotEnd).toBe("11:30");
    expect(res.body.data[0].compatibleEntries).toHaveLength(1);
    expect(res.body.data[0].compatibleEntries[0].notes).toBe("Fits after queue");
  });
});
