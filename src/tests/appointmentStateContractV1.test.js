const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const {
  getSemanticStateFromLegacyStatus,
  isTerminalAppointmentState,
} = require("../services/appointment/stateService");
const {
  createOperationalCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

const sendOwnerAppointmentUpdate = (fixture, payload) =>
  request(app)
    .put(`/appointments/${fixture.appointment._id}`)
    .set("Authorization", `Bearer ${fixture.token}`)
    .send(payload);

const sendOwnerStatusUpdate = (fixture, status) =>
  request(app)
    .put(`/appointments/${fixture.appointment._id}/status`)
    .set("Authorization", `Bearer ${fixture.token}`)
    .send({ status });

describe("Appointment state contract v1", () => {
  test("keeps legacy status mapping centralized for booking and visit states", () => {
    expect(getSemanticStateFromLegacyStatus("Missed")).toEqual({
      bookingStatus: "confirmed",
      visitStatus: "no_show",
    });

    expect(
      isTerminalAppointmentState({
        status: "Confirmed",
        bookingStatus: "confirmed",
        visitStatus: "completed",
      })
    ).toBe(true);
  });

  test("blocks check-in and start-service when semantic visit state is terminal", async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerName: "State Owner",
      ownerEmail: "state-owner@example.com",
      businessName: "State Shop",
      appointmentStatus: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "completed",
    });

    const checkInRes = await request(app)
      .post(`/appointments/${fixture.appointment._id}/check-in`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(checkInRes.status).toBe(409);
    expect(checkInRes.body.message).toMatch(/final state/i);

    const startServiceRes = await request(app)
      .post(`/appointments/${fixture.appointment._id}/start-service`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(startServiceRes.status).toBe(409);
    expect(startServiceRes.body.message).toMatch(/final state/i);
  });

  test("blocks reschedule when semantic booking state is cancelled", async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerName: "State Reschedule Owner",
      ownerEmail: "state-reschedule-owner@example.com",
      businessName: "State Reschedule Shop",
      appointmentStatus: "Confirmed",
      bookingStatus: "cancelled",
      visitStatus: "not_started",
    });

    const res = await sendOwnerAppointmentUpdate(fixture, {
      date: "2026-04-19",
      startTime: "11:30",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot reschedule/i);
  });

  test("persists cancellation as cancelled booking and cancelled visit", async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerName: "State Cancel Owner",
      ownerEmail: "state-cancel-owner@example.com",
      businessName: "State Cancel Shop",
    });

    const res = await sendOwnerStatusUpdate(fixture, "Canceled");

    expect(res.status).toBe(200);

    const stored = await Appointment.findById(fixture.appointment._id).lean();
    expect(stored.status).toBe("Canceled");
    expect(stored.bookingStatus).toBe("cancelled");
    expect(stored.visitStatus).toBe("cancelled");
  });

  test("persists completion as confirmed booking and completed visit", async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerName: "State Complete Owner",
      ownerEmail: "state-complete-owner@example.com",
      businessName: "State Complete Shop",
    });

    await Appointment.findByIdAndUpdate(fixture.appointment._id, {
      visitStatus: "in_service",
      operationalTimestamps: {
        checkedInAt: new Date(),
        checkedInBy: fixture.owner._id,
        serviceStartedAt: new Date(),
        serviceStartedBy: fixture.owner._id,
      },
    });

    const res = await sendOwnerStatusUpdate(fixture, "Completed");

    expect(res.status).toBe(200);

    const stored = await Appointment.findById(fixture.appointment._id).lean();
    expect(stored.status).toBe("Completed");
    expect(stored.bookingStatus).toBe("confirmed");
    expect(stored.visitStatus).toBe("completed");
  });

  test("persists no-show as confirmed booking and no-show visit", async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerName: "State No Show Owner",
      ownerEmail: "state-no-show-owner@example.com",
      businessName: "State No Show Shop",
    });

    const res = await sendOwnerStatusUpdate(fixture, "No-Show");

    expect(res.status).toBe(200);

    const stored = await Appointment.findById(fixture.appointment._id).lean();
    expect(stored.status).toBe("No-Show");
    expect(stored.bookingStatus).toBe("confirmed");
    expect(stored.visitStatus).toBe("no_show");
  });
});
