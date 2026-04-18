const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const Business = require("../models/User/business");
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

describe("Policy engine v2", () => {
  let fixture;
  let appointment;
  let business;
  let token;

  beforeEach(async () => {
    fixture = await createCommerceFixture({
      ownerName: "Policy Owner",
      ownerEmail: "policy-owner@example.com",
      businessName: "Policy Shop",
      appointmentStatus: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "not_started",
      paymentStatus: "Pending",
      bookingBuffer: 45,
      penaltySettings: {
        noShowPenalty: true,
        noShowPenaltyAmount: 25,
      },
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
    business = fixture.business;
    token = fixture.token;
  });

  test("stores expanded policy snapshot on new appointments", async () => {
    const stored = await Appointment.findById(appointment._id).lean();

    expect(stored.policySnapshot).toBeTruthy();
    expect(stored.policySnapshot.version).toBe(2);
    expect(stored.policySnapshot.noShowPenaltyEnabled).toBe(true);
    expect(stored.policySnapshot.noShowPenaltyAmount).toBe(25);
    expect(stored.policySnapshot.bookingBufferMinutes).toBe(45);
    expect(stored.policySnapshot.capturedAt).toBeTruthy();
  });

  test("applies no-show penalty from frozen snapshot even if business settings change later", async () => {
    await Business.findByIdAndUpdate(business._id, {
      $set: {
        "penaltySettings.noShowPenalty": true,
        "penaltySettings.noShowPenaltyAmount": 60,
      },
    });

    const res = await request(app)
      .put(`/appointments/${appointment._id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "No-Show" });

    expect(res.status).toBe(200);

    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.status).toBe("No-Show");
    expect(stored.penalty.applied).toBe(true);
    expect(stored.penalty.amount).toBe(25);
    expect(stored.policySnapshot.noShowPenaltyAmount).toBe(25);
  });

  test("falls back to current business settings when an old appointment lacks a sufficient snapshot", async () => {
    await Appointment.findByIdAndUpdate(appointment._id, {
      $set: {
        policySnapshot: {},
      },
    });

    await Business.findByIdAndUpdate(business._id, {
      $set: {
        "penaltySettings.noShowPenalty": true,
        "penaltySettings.noShowPenaltyAmount": 40,
      },
    });

    const res = await request(app)
      .put(`/appointments/${appointment._id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "No-Show" });

    expect(res.status).toBe(200);

    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.penalty.applied).toBe(true);
    expect(stored.penalty.amount).toBe(40);
  });
});
