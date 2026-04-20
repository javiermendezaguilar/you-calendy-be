const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Appointment = require("../models/appointment");
const User = require("../models/User/user");
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

describe("Appointment permissions v1", () => {
  let owner;
  let client;
  let staff;
  let appointment;
  let ownerToken;
  let assignedStaffToken;
  let foreignBarberToken;
  let clientToken;

  beforeEach(async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Permissions Owner",
      ownerEmail: "permissions-owner@example.com",
      businessName: "Permissions Shop",
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
      staffEmail: "assigned-staff@example.com",
    });

    owner = fixture.owner;
    client = fixture.client;
    staff = fixture.staff;
    appointment = fixture.appointment;
    ownerToken = fixture.token;

    const assignedStaffUser = await User.create({
      name: "Assigned Staff User",
      email: staff.email,
      password: "password123",
      role: "barber",
      isActive: true,
    });

    assignedStaffToken = jwt.sign(
      { id: assignedStaffUser._id, role: "barber" },
      process.env.JWT_SECRET
    );

    const foreignBarber = await User.create({
      name: "Foreign Barber",
      email: "foreign-barber@example.com",
      password: "password123",
      role: "barber",
      isActive: true,
    });

    foreignBarberToken = jwt.sign(
      { id: foreignBarber._id, role: "barber" },
      process.env.JWT_SECRET
    );

    clientToken = jwt.sign(
      { id: client._id, role: "client", type: "client", businessId: appointment.business },
      process.env.JWT_SECRET
    );
  });

  test("allows the business owner to check in an appointment", async () => {
    const res = await request(app)
      .post(`/appointments/${appointment._id}/check-in`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.visitStatus).toBe("checked_in");
  });

  test("allows the assigned staff user to check in their own appointment", async () => {
    const res = await request(app)
      .post(`/appointments/${appointment._id}/check-in`)
      .set("Authorization", `Bearer ${assignedStaffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.visitStatus).toBe("checked_in");
  });

  test("allows the assigned staff user to start service for their own appointment", async () => {
    await Appointment.findByIdAndUpdate(appointment._id, {
      visitStatus: "checked_in",
      operationalTimestamps: {
        checkedInAt: new Date(),
        checkedInBy: owner._id,
      },
    });

    const res = await request(app)
      .post(`/appointments/${appointment._id}/start-service`)
      .set("Authorization", `Bearer ${assignedStaffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.visitStatus).toBe("in_service");
  });

  test("allows the assigned staff user to mark their own appointment as completed", async () => {
    const res = await request(app)
      .put(`/appointments/${appointment._id}/status`)
      .set("Authorization", `Bearer ${assignedStaffToken}`)
      .send({ status: "Completed" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Completed");
  });

  test("rejects the assigned staff user when marking no-show", async () => {
    const res = await request(app)
      .put(`/appointments/${appointment._id}/status`)
      .set("Authorization", `Bearer ${assignedStaffToken}`)
      .send({ status: "No-Show" });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/business owner/i);
  });

  test("rejects a foreign barber checking in an appointment from another business", async () => {
    const res = await request(app)
      .post(`/appointments/${appointment._id}/check-in`)
      .set("Authorization", `Bearer ${foreignBarberToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not authorized/i);
  });

  test("rejects a foreign barber marking an appointment as completed", async () => {
    const res = await request(app)
      .put(`/appointments/${appointment._id}/status`)
      .set("Authorization", `Bearer ${foreignBarberToken}`)
      .send({ status: "Completed" });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/only the business owner/i);
  });

  test("allows the client to cancel their own appointment", async () => {
    const res = await request(app)
      .put(`/appointments/${appointment._id}/status`)
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ status: "Canceled" });

    expect(res.status).toBe(200);

    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.status).toBe("Canceled");
  });
});
