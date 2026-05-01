const request = require("supertest");

const app = require("../app");
const Appointment = require("../models/appointment");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");

describe("BE-P2-05 appointment list pagination, filters and order", () => {
  let fixture;
  let consoleLogSpy;

  beforeAll(async () => {
    await connectCommerceTestDatabase();
  });

  afterAll(async () => {
    await disconnectCommerceTestDatabase();
    await new Promise((resolve) => {
      setTimeout(resolve, 1100);
    });
  });

  beforeEach(async () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    fixture = await createCommerceFixture();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  const authGet = (path) =>
    request(app).get(path).set("Authorization", `Bearer ${fixture.token}`);

  const createSameSlotAppointments = async () => {
    const base = {
      client: fixture.client._id,
      business: fixture.business._id,
      service: fixture.service._id,
      staff: fixture.staff._id,
      date: fixture.appointment.date,
      startTime: fixture.appointment.startTime,
      endTime: fixture.appointment.endTime,
      duration: fixture.appointment.duration,
      status: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "not_started",
      visitType: "appointment",
      paymentStatus: "Pending",
      price: 35,
      policySnapshot: fixture.appointment.policySnapshot,
    };

    const extra = await Appointment.insertMany([base, base]);
    return [fixture.appointment, ...extra];
  };

  test("rejects invalid appointment list pagination before controller execution", async () => {
    const res = await authGet("/appointments?page=0");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("returns /appointments in deterministic order with pagination metadata", async () => {
    const allAppointments = await createSameSlotAppointments();
    const expectedFirstPageIds = allAppointments
      .map((appointment) => appointment._id.toString())
      .sort()
      .slice(0, 2);

    const res = await authGet("/appointments?page=1&limit=2");

    expect(res.status).toBe(200);
    expect(res.body.data.pagination).toMatchObject({
      total: 3,
      page: 1,
      limit: 2,
      pages: 2,
      hasMore: true,
    });
    expect(
      res.body.data.appointments.map((appointment) => appointment._id.toString())
    ).toEqual(expectedFirstPageIds);
  });

  test("rejects invalid business appointment query params", async () => {
    const res = await authGet("/business/appointments?limit=201");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("returns /business/appointments in deterministic order with pagination metadata", async () => {
    const allAppointments = await createSameSlotAppointments();
    const expectedFirstPageIds = allAppointments
      .map((appointment) => appointment._id.toString())
      .sort()
      .slice(0, 2);

    const res = await authGet("/business/appointments?page=1&limit=2");

    expect(res.status).toBe(200);
    expect(res.body.data.pagination).toMatchObject({
      total: 3,
      page: 1,
      limit: 2,
      pages: 2,
      hasMore: true,
    });
    expect(
      res.body.data.appointments.map((appointment) => appointment._id.toString())
    ).toEqual(expectedFirstPageIds);
  });
});
