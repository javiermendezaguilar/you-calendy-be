const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const DomainEvent = require("../models/domainEvent");
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

describe("Booking event map v3", () => {
  let fixture;
  let clientToken;

  beforeEach(async () => {
    fixture = await createCommerceFixture({
      ownerName: "Booking Owner",
      ownerEmail: "booking-owner@example.com",
      businessName: "Booking Shop",
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

    fixture.staff.services = [{ service: fixture.service._id, timeInterval: 45 }];
    await fixture.staff.save();
    fixture.business.services = [
      {
        _id: fixture.service._id,
        name: fixture.service.name,
        type: "Barber",
        price: fixture.service.price,
        currency: fixture.service.currency,
      },
    ];
    await fixture.business.save();

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
    const res = await request(app)
      .post("/appointments/barber")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        clientId: fixture.client._id,
        serviceId: fixture.service._id,
        staffId: fixture.staff._id,
        date: "2026-05-04",
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
