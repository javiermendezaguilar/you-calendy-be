const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const PolicyCharge = require("../models/policyCharge");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createOperationalCommerceFixture,
} = require("./helpers/commerceFixture");

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("Appointment input validation v1", () => {
  let fixture;
  let token;

  beforeEach(async () => {
    fixture = await createOperationalCommerceFixture(
      {
        ownerName: "Appointment Input Owner",
        ownerEmail: "appointment-input-owner@example.com",
        businessName: "Appointment Input Shop",
        bookingBuffer: 0,
      },
      {
        staffTimeInterval: 45,
        syncBusinessServices: true,
      }
    );
    token = fixture.token;
  });

  const authGet = (route) =>
    request(app).get(route).set("Authorization", `Bearer ${token}`);

  const authPost = (route) =>
    request(app).post(route).set("Authorization", `Bearer ${token}`);

  const authPut = (route) =>
    request(app).put(route).set("Authorization", `Bearer ${token}`);

  test("rejects malformed appointment creation input before creating an appointment", async () => {
    const appointmentCount = await Appointment.countDocuments();

    const res = await authPost("/appointments").send({
      businessId: "not-an-id",
      clientId: fixture.client._id,
      serviceId: fixture.service._id,
      staffId: fixture.staff._id,
      date: "2026-12-15",
      startTime: "10:00",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/businessId/i);
    expect(await Appointment.countDocuments()).toBe(appointmentCount);
  });

  test("rejects invalid availability query before running availability lookup", async () => {
    const res = await request(app).get("/appointments/available").query({
      businessId: String(fixture.business._id),
      serviceId: "not-an-id",
      date: "2026-12-15",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/serviceId/i);
  });

  test("rejects malformed appointment ids and status payloads before mutation", async () => {
    const invalidIdRes = await authGet("/appointments/not-an-id");
    expect(invalidIdRes.status).toBe(400);
    expect(invalidIdRes.body.message).toMatch(/id/i);

    const invalidStatusRes = await authPut(
      `/appointments/${fixture.appointment._id}/status`
    ).send({
      status: "Done",
    });

    expect(invalidStatusRes.status).toBe(400);
    expect(invalidStatusRes.body.message).toMatch(/status/i);

    const stored = await Appointment.findById(fixture.appointment._id).lean();
    expect(stored.status).toBe("Confirmed");
  });

  test("rejects invalid policy charge input before creating policy charges", async () => {
    const policyChargeCount = await PolicyCharge.countDocuments();

    const invalidTypeRes = await authPost(
      `/appointments/${fixture.appointment._id}/policy-charges`
    ).send({
      type: "surprise_fee",
      amount: 10,
    });

    expect(invalidTypeRes.status).toBe(400);
    expect(invalidTypeRes.body.message).toMatch(/type/i);

    const invalidAmountRes = await authPost(
      `/appointments/${fixture.appointment._id}/policy-charges`
    ).send({
      type: "deposit",
      amount: -1,
    });

    expect(invalidAmountRes.status).toBe(400);
    expect(invalidAmountRes.body.message).toMatch(/amount/i);
    expect(await PolicyCharge.countDocuments()).toBe(policyChargeCount);
  });

  test("rejects invalid appointment query and operational payloads", async () => {
    const invalidListQueryRes = await authGet("/appointments").query({
      staffId: "not-an-id",
    });

    expect(invalidListQueryRes.status).toBe(400);
    expect(invalidListQueryRes.body.message).toMatch(/staffId/i);

    const invalidDelayRes = await authPost(
      `/appointments/${fixture.appointment._id}/delay`
    ).send({
      newDate: "2026-12-15",
      newStartTime: "25:00",
      message: "We are running late",
    });

    expect(invalidDelayRes.status).toBe(400);
    expect(invalidDelayRes.body.message).toMatch(/newStartTime/i);

    const invalidReminderRes = await authPut(
      `/appointments/${fixture.appointment._id}/reminder-settings`
    ).send({
      reminderTime: "9_hours_before",
      appointmentReminder: true,
    });

    expect(invalidReminderRes.status).toBe(400);
    expect(invalidReminderRes.body.message).toMatch(/reminderTime/i);
  });
});
