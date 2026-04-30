const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const User = require("../models/User/user");
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

describe("Auth input validation v1", () => {
  let fixture;
  let token;

  beforeEach(async () => {
    fixture = await createCommerceFixture({
      ownerName: "Auth Input Owner",
      ownerEmail: "auth-input-owner@example.com",
      businessName: "Auth Input Shop",
    });
    token = fixture.token;
  });

  const authPatch = (route) =>
    request(app).patch(route).set("Authorization", `Bearer ${token}`);

  const authPut = (route) =>
    request(app).put(route).set("Authorization", `Bearer ${token}`);

  test("rejects malformed login payloads before credential comparison", async () => {
    const res = await request(app).post("/auth/login").send({
      email: "not-an-email",
      password: "password123",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
  });

  test("rejects malformed registration payloads before creating account data", async () => {
    const userCount = await User.countDocuments();
    const businessCount = await Business.countDocuments();

    const res = await request(app).post("/auth/register").send({
      email: "new-owner@example.com",
      password: "password123",
      personalName: "New",
      surname: "Owner",
      phone: "+34999999999",
      businessName: "New Shop",
      address: {
        streetName: "Main",
        houseNumber: "1",
        city: "Madrid",
        postalCode: "28001",
      },
      location: {
        coordinates: ["bad", -3.7],
        address: "Main 1, Madrid",
      },
      businessHours: {
        monday: { enabled: true, shifts: [] },
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/coordinates/i);
    expect(await User.countDocuments()).toBe(userCount);
    expect(await Business.countDocuments()).toBe(businessCount);
  });

  test("rejects invalid password reset input and handles missing reset state safely", async () => {
    const invalidShapeRes = await request(app).put("/auth/resetPassword").send({
      email: fixture.owner.email,
      passwordResetToken: "abc123",
      password: "newpassword123",
    });

    expect(invalidShapeRes.status).toBe(400);
    expect(invalidShapeRes.body.message).toMatch(/passwordResetToken/i);

    const missingTokenRes = await request(app).put("/auth/resetPassword").send({
      email: fixture.owner.email,
      passwordResetToken: "123456",
      password: "newpassword123",
    });

    expect(missingTokenRes.status).toBe(400);
    expect(missingTokenRes.body.message).toMatch(/Invalid token/i);
  });

  test("rejects malformed authenticated password updates before mutating password", async () => {
    const res = await authPut("/auth/updatePassword").send({
      currentPassword: "password123",
      newPassword: "123",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/newPassword/i);

    const stored = await User.findById(fixture.owner._id).select("+password");
    await expect(stored.comparePassword("password123")).resolves.toBe(true);
  });

  test("rejects ambiguous notification settings before updating user preferences", async () => {
    const res = await authPatch("/auth/notification-settings").send({
      isNotificationEnabled: "maybe",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/isNotificationEnabled/i);

    const stored = await User.findById(fixture.owner._id).lean();
    expect(stored.isNotificationEnabled).toBe(true);
  });

  test("rejects malformed social auth and logout payloads", async () => {
    const userCount = await User.countDocuments();

    const socialRes = await request(app).post("/auth/socialAuth").send({
      email: "social@example.com",
      name: "Social User",
      provider: "github",
    });

    expect(socialRes.status).toBe(400);
    expect(socialRes.body.message).toMatch(/provider/i);
    expect(await User.countDocuments()).toBe(userCount);

    const logoutRes = await request(app).post("/auth/logout").send({
      userType: "superadmin",
    });

    expect(logoutRes.status).toBe(400);
    expect(logoutRes.body.message).toMatch(/userType/i);
  });

  test("rejects malformed legacy barber route input before Mongo casts", async () => {
    const invalidBarberRes = await request(app)
      .get("/auth/barbers/not-an-id")
      .set("Authorization", `Bearer ${token}`);

    expect(invalidBarberRes.status).toBe(400);
    expect(invalidBarberRes.body.message).toMatch(/id/i);

    const admin = await User.create({
      name: "Auth Input Admin",
      email: "auth-input-admin@example.com",
      password: "password123",
      role: "admin",
      isActive: true,
    });
    const adminToken = jwt.sign(
      { id: admin._id, role: "admin" },
      process.env.JWT_SECRET
    );

    const invalidStatusRes = await request(app)
      .patch(`/auth/barbers/${fixture.owner._id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "paused",
      });

    expect(invalidStatusRes.status).toBe(400);
    expect(invalidStatusRes.body.message).toMatch(/status/i);

    const stored = await User.findById(fixture.owner._id).lean();
    expect(stored.status).toBe("activated");
  });
});
