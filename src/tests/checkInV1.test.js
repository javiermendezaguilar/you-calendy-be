const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
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

describe("Check-in v1", () => {
  let appointment;
  let token;

  beforeEach(async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Checkin Owner",
      ownerEmail: "checkin-owner@example.com",
      businessName: "Checkin Shop",
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

    appointment = fixture.appointment;
    token = fixture.token;
  });

  test("checks in a confirmed appointment and persists operator timestamp", async () => {
    const res = await request(app)
      .post(`/appointments/${appointment._id}/check-in`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.visitStatus).toBe("checked_in");
    expect(res.body.data.operationalTimestamps.checkedInAt).toBeTruthy();
    expect(res.body.data.operationalTimestamps.checkedInBy).toBeTruthy();

    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.visitStatus).toBe("checked_in");
    expect(stored.operationalTimestamps.checkedInAt).not.toBeNull();
    expect(stored.operationalTimestamps.checkedInBy.toString()).toBeDefined();
  });

  test("starts service only after check-in and persists service start timestamp", async () => {
    const checkInRes = await request(app)
      .post(`/appointments/${appointment._id}/check-in`)
      .set("Authorization", `Bearer ${token}`);

    expect(checkInRes.status).toBe(200);

    const startRes = await request(app)
      .post(`/appointments/${appointment._id}/start-service`)
      .set("Authorization", `Bearer ${token}`);

    expect(startRes.status).toBe(200);
    expect(startRes.body.data.visitStatus).toBe("in_service");
    expect(startRes.body.data.operationalTimestamps.serviceStartedAt).toBeTruthy();
    expect(startRes.body.data.operationalTimestamps.serviceStartedBy).toBeTruthy();

    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.visitStatus).toBe("in_service");
    expect(stored.operationalTimestamps.serviceStartedAt).not.toBeNull();
  });

  test("rejects start-service when appointment has not been checked in", async () => {
    const startRes = await request(app)
      .post(`/appointments/${appointment._id}/start-service`)
      .set("Authorization", `Bearer ${token}`);

    expect(startRes.status).toBe(409);
    expect(startRes.body.message).toMatch(/must be checked in/i);
  });
});
