const request = require("supertest");

const app = require("../app");
const Appointment = require("../models/appointment");
const {
  createCommerceFixture,
} = require("./helpers/commerceFixture");
const { useCommerceTestDatabase } = require("./helpers/testLifecycle");

describe("BE-P2-05 appointment list pagination, filters and order", () => {
  let fixture;
  let consoleLogSpy;

  useCommerceTestDatabase();

  beforeEach(async () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    fixture = await createCommerceFixture();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  const authGet = (path) =>
    request(app).get(path).set("Authorization", `Bearer ${fixture.token}`);

  const listCases = [
    {
      label: "/appointments",
      invalidPath: "/appointments?page=0",
      listPath: "/appointments?page=1&limit=2",
    },
    {
      label: "/business/appointments",
      invalidPath: "/business/appointments?limit=201",
      listPath: "/business/appointments?page=1&limit=2",
    },
  ];

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

  const buildExpectedFirstPageIds = (appointments) =>
    appointments
      .map((appointment) => appointment._id.toString())
      .sort()
      .slice(0, 2);

  const expectStableFirstPage = (res, expectedFirstPageIds) => {
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
  };

  test.each(listCases)(
    "rejects invalid query params for $label",
    async ({ invalidPath }) => {
      const res = await authGet(invalidPath);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
  );

  test.each(listCases)(
    "returns $label in deterministic order with pagination metadata",
    async ({ listPath }) => {
      const allAppointments = await createSameSlotAppointments();
      const expectedFirstPageIds = buildExpectedFirstPageIds(allAppointments);
      const res = await authGet(listPath);

      expectStableFirstPage(res, expectedFirstPageIds);
    }
  );
});
