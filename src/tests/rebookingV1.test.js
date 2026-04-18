const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
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

describe("Rebooking v1", () => {
  let owner;
  let business;
  let client;
  let service;
  let staff;
  let appointment;
  let token;
  let paidCheckout;

  beforeEach(async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Rebooking Owner",
      ownerEmail: "rebooking-owner@example.com",
      businessName: "Rebooking Shop",
      appointmentStatus: "Completed",
      paymentStatus: "Paid",
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

    owner = fixture.owner;
    business = fixture.business;
    client = fixture.client;
    service = fixture.service;
    staff = fixture.staff;
    appointment = fixture.appointment;
    token = fixture.token;

    paidCheckout = await Checkout.create({
      appointment: appointment._id,
      business: business._id,
      client: client._id,
      staff: staff._id,
      status: "paid",
      currency: "EUR",
      subtotal: 35,
      discountTotal: 0,
      tip: 4,
      total: 39,
      sourcePrice: 35,
      snapshot: {
        appointmentStatus: "Completed",
        bookingStatus: "confirmed",
        visitStatus: "completed",
        service: {
          id: service._id,
          name: service.name,
        },
        client: {
          id: client._id,
          firstName: client.firstName,
          lastName: client.lastName,
          phone: client.phone,
        },
        staff: {
          id: staff._id,
          firstName: staff.firstName,
          lastName: staff.lastName,
        },
        discounts: {
          promotion: { applied: false, id: null, amount: 0 },
          flashSale: { applied: false, id: null, amount: 0 },
        },
      },
      closedAt: new Date(),
      closedBy: owner._id,
    });

    await Payment.create({
      checkout: paidCheckout._id,
      appointment: appointment._id,
      business: business._id,
      client: client._id,
      staff: staff._id,
      status: "captured",
      method: "cash",
      currency: "EUR",
      amount: 39,
      tip: 4,
      reference: "rebooking-test-payment",
      capturedAt: new Date(),
      capturedBy: owner._id,
      snapshot: {
        subtotal: 35,
        discountTotal: 0,
        total: 39,
        sourcePrice: 35,
        service: {
          id: service._id,
          name: service.name,
        },
        client: {
          id: client._id,
          firstName: client.firstName,
          lastName: client.lastName,
        },
        discounts: {
          promotionAmount: 0,
          flashSaleAmount: 0,
        },
      },
    });
  });

  test("creates a rebooking from a paid checkout and persists traceability", async () => {
    const rebookRes = await request(app)
      .post(`/checkout/${paidCheckout._id}/rebook`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        date: "2026-05-02",
        startTime: "11:30",
      });

    expect(rebookRes.status).toBe(201);
    expect(rebookRes.body.data.status).toBe("Confirmed");
    expect(rebookRes.body.data.bookingStatus).toBe("booked");
    expect(rebookRes.body.data.visitStatus).toBe("not_started");
    expect(rebookRes.body.data.paymentStatus).toBe("Pending");
    expect(rebookRes.body.data.price).toBe(50);

    const storedCheckout = await Checkout.findById(paidCheckout._id).lean();
    expect(storedCheckout.rebooking.status).toBe("booked");
    expect(storedCheckout.rebooking.appointment).not.toBeNull();

    const rebookedAppointment = await Appointment.findById(
      storedCheckout.rebooking.appointment
    ).lean();
    expect(rebookedAppointment).not.toBeNull();
    expect(rebookedAppointment.rebookingOrigin.checkout.toString()).toBe(
      paidCheckout._id.toString()
    );
    expect(rebookedAppointment.rebookingOrigin.appointment.toString()).toBe(
      appointment._id.toString()
    );
  });

  test("rejects a duplicate rebooking for the same checkout", async () => {
    const firstRebook = await request(app)
      .post(`/checkout/${paidCheckout._id}/rebook`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        date: "2026-05-02",
        startTime: "11:30",
      });

    expect(firstRebook.status).toBe(201);

    const duplicateRebook = await request(app)
      .post(`/checkout/${paidCheckout._id}/rebook`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        date: "2026-05-03",
        startTime: "12:30",
      });

    expect(duplicateRebook.status).toBe(409);
    expect(duplicateRebook.body.message).toMatch(/rebooking already exists/i);
  });

  test("rejects rebooking from a checkout that is not paid", async () => {
    paidCheckout.status = "closed";
    await paidCheckout.save();

    const rebookRes = await request(app)
      .post(`/checkout/${paidCheckout._id}/rebook`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        date: "2026-05-02",
        startTime: "11:30",
      });

    expect(rebookRes.status).toBe(409);
    expect(rebookRes.body.message).toMatch(/must be paid/i);
  });
});
