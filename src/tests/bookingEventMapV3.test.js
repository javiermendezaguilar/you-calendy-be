const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const DomainEvent = require("../models/domainEvent");
const {
  createOperationalCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

const futureDateOnly = (daysAhead = 7) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
};

describe("Booking event map v3", () => {
  let fixture;
  let clientToken;

  beforeEach(async () => {
    fixture = await createOperationalCommerceFixture({
      ownerName: "Booking Owner",
      ownerEmail: "booking-owner@example.com",
      businessName: "Booking Shop",
    }, {
      staffTimeInterval: 45,
      syncBusinessServices: true,
    });

    clientToken = jwt.sign(
      {
        id: fixture.client._id,
        role: "client",
        type: "client",
        businessId: fixture.business._id,
      },
      process.env.JWT_SECRET
    );
  });

  test("records booking_created when barber creates an appointment", async () => {
    const bookingDate = futureDateOnly(7);

    const res = await request(app)
      .post("/appointments/barber")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        clientId: fixture.client._id,
        serviceId: fixture.service._id,
        staffId: fixture.staff._id,
        date: bookingDate,
        startTime: "12:00",
        price: 35,
      });

    expect(res.status).toBe(201);

    const event = await DomainEvent.findOne({
      type: "booking_created",
      correlationId: res.body.data._id.toString(),
    }).lean();

    expect(event).not.toBeNull();
    expect(event.payload.source).toBe("barber_booking");
  });

  test("records booking_modified when an appointment is rescheduled", async () => {
    const res = await request(app)
      .put(`/appointments/${fixture.appointment._id}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        date: "2026-04-19",
        startTime: "11:30",
      });

    expect(res.status).toBe(200);

    const event = await DomainEvent.findOne({
      type: "booking_modified",
      correlationId: fixture.appointment._id.toString(),
    }).lean();

    expect(event).not.toBeNull();
    expect(event.payload.modifiedFields).toEqual(
      expect.arrayContaining(["date", "startTime", "endTime", "duration", "bookingStatus", "visitStatus"])
    );
  });

  test("records booking_cancelled when the client cancels their own appointment", async () => {
    const res = await request(app)
      .put(`/appointments/${fixture.appointment._id}/status`)
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ status: "Canceled" });

    expect(res.status).toBe(200);

    const event = await DomainEvent.findOne({
      type: "booking_cancelled",
      correlationId: fixture.appointment._id.toString(),
    }).lean();

    expect(event).not.toBeNull();
    expect(event.payload.cancelledBy).toBe("client");
  });
});
