const request = require("supertest");
const app = require("../app");
const DomainEvent = require("../models/domainEvent");
const {
  createOperationalCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

describe("Appointment event map v2", () => {
  let appointment;
  let token;

  beforeEach(async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerName: "EventMap Owner",
      ownerEmail: "eventmap-owner@example.com",
      businessName: "EventMap Shop",
    });

    appointment = fixture.appointment;
    token = fixture.token;
  });

  test("records service_completed when an owner marks an appointment completed", async () => {
    const res = await request(app)
      .put(`/appointments/${appointment._id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "Completed" });

    expect(res.status).toBe(200);

    const event = await DomainEvent.findOne({
      type: "service_completed",
      "payload.appointmentId": appointment._id,
    }).lean();

    expect(event).not.toBeNull();
    expect(event.payload.status).toBe("Completed");
  });

  test("records no_show_marked when an owner marks an appointment as no-show", async () => {
    const res = await request(app)
      .put(`/appointments/${appointment._id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "No-Show" });

    expect(res.status).toBe(200);

    const event = await DomainEvent.findOne({
      type: "no_show_marked",
      "payload.appointmentId": appointment._id,
    }).lean();

    expect(event).not.toBeNull();
    expect(event.payload.status).toBe("No-Show");
  });
});
