const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User/user");
const commerceFixture = require("./helpers/commerceFixture");

const authHeaderFor = (payload) =>
  `Bearer ${jwt.sign(payload, process.env.JWT_SECRET)}`;

const clientAuthHeaderFor = (clientId, businessId) =>
  authHeaderFor({
    id: clientId,
    type: "client",
    role: "client",
    businessId: businessId.toString(),
  });

beforeAll(async () => {
  await commerceFixture.connectCommerceTestDatabase();
});

afterAll(async () => {
  await commerceFixture.disconnectCommerceTestDatabase();
});

describe("Auth actor context v1", () => {
  test("returns owner actor context for business owner users", async () => {
    const fixture = await commerceFixture.createCommerceFixture({
      ownerName: "Actor Owner",
      ownerEmail: "actor-owner@example.com",
      businessName: "Actor Shop",
    });

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.password).toBeUndefined();
    expect(res.body.data.actorContext).toMatchObject({
      actorType: "owner",
      authSubjectType: "user",
      userId: fixture.owner._id.toString(),
      businessId: fixture.business._id.toString(),
      clientId: null,
      staffId: null,
      isBusinessOwner: true,
      isClient: false,
    });
  });

  test("returns client actor context for authenticated clients", async () => {
    const fixture = await commerceFixture.createCommerceFixture({
      ownerName: "Actor Client Owner",
      ownerEmail: "actor-client-owner@example.com",
      businessName: "Actor Client Shop",
    });

    const res = await request(app)
      .get("/auth/me")
      .set(
        "Authorization",
        clientAuthHeaderFor(fixture.client._id, fixture.business._id)
      );

    expect(res.status).toBe(200);
    expect(res.body.data.password).toBeUndefined();
    expect(res.body.data.actorContext).toMatchObject({
      actorType: "client",
      authSubjectType: "client",
      userId: null,
      clientId: fixture.client._id.toString(),
      businessId: fixture.business._id.toString(),
      isBusinessOwner: false,
      isClient: true,
    });
  });

  test("returns staff actor context for legacy staff users matched by email", async () => {
    const fixture = await commerceFixture.createCommerceFixture({
      ownerName: "Actor Staff Owner",
      ownerEmail: "actor-staff-owner@example.com",
      businessName: "Actor Staff Shop",
      staffEmail: "actor-staff@example.com",
    });
    const staffUser = await User.create({
      name: "Actor Staff User",
      email: fixture.staff.email,
      password: "password123",
      role: "barber",
      isActive: true,
    });

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", authHeaderFor({ id: staffUser._id, role: "barber" }));

    expect(res.status).toBe(200);
    expect(res.body.data.actorContext).toMatchObject({
      actorType: "staff",
      authSubjectType: "user",
      userId: staffUser._id.toString(),
      businessId: fixture.business._id.toString(),
      staffId: fixture.staff._id.toString(),
      isBusinessOwner: false,
      isClient: false,
      legacyResolution: {
        type: "staff_email_match",
        field: "email",
      },
    });
    expect(res.body.data.actorContext.staffMemberships).toEqual([
      expect.objectContaining({
        staffId: fixture.staff._id.toString(),
        businessId: fixture.business._id.toString(),
        email: fixture.staff.email,
      }),
    ]);
  });

  test("keeps /auth/me protected without token", async () => {
    const res = await request(app).get("/auth/me");

    expect(res.status).toBe(401);
  });
});
