const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User/user");
const Business = require("../models/User/business");
const Staff = require("../models/staff");
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

  test("prefers explicit staff user link over legacy email match", async () => {
    const linkedFixture = await commerceFixture.createCommerceFixture({
      ownerName: "Actor Explicit Linked Owner",
      ownerEmail: "actor-explicit-linked-owner@example.com",
      businessName: "Actor Explicit Linked Shop",
      staffEmail: "actor-explicit-linked-staff@example.com",
    });
    const emailMatchOwner = await User.create({
      name: "Actor Explicit Email Owner",
      email: "actor-explicit-email-owner@example.com",
      password: "password123",
      role: "barber",
      isActive: true,
    });
    const emailMatchBusiness = await Business.create({
      owner: emailMatchOwner._id,
      name: "Actor Explicit Email Shop",
      contactInfo: { phone: "+34333333333" },
    });
    const emailMatchedStaff = await Staff.create({
      business: emailMatchBusiness._id,
      firstName: "Email",
      lastName: "Match",
      email: "actor-explicit-staff@example.com",
    });
    const staffUser = await User.create({
      name: "Actor Explicit Staff User",
      email: emailMatchedStaff.email,
      password: "password123",
      role: "barber",
      isActive: true,
    });

    linkedFixture.staff.user = staffUser._id;
    await linkedFixture.staff.save();

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", authHeaderFor({ id: staffUser._id, role: "barber" }));

    expect(res.status).toBe(200);
    expect(res.body.data.actorContext).toMatchObject({
      actorType: "staff",
      userId: staffUser._id.toString(),
      businessId: linkedFixture.business._id.toString(),
      staffId: linkedFixture.staff._id.toString(),
      legacyResolution: {
        type: "staff_user_link",
        field: "user",
      },
    });
    expect(res.body.data.actorContext.staffMemberships).toEqual([
      expect.objectContaining({
        staffId: linkedFixture.staff._id.toString(),
        businessId: linkedFixture.business._id.toString(),
        userId: staffUser._id.toString(),
        email: linkedFixture.staff.email,
      }),
    ]);
    expect(res.body.data.actorContext.staffMemberships).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          staffId: emailMatchedStaff._id.toString(),
        }),
      ])
    );
  });

  test("does not choose a tenant implicitly for multiple explicit staff links", async () => {
    const firstFixture = await commerceFixture.createCommerceFixture({
      ownerName: "Actor Multi Staff Owner One",
      ownerEmail: "actor-multi-staff-owner-one@example.com",
      businessName: "Actor Multi Staff Shop One",
      staffEmail: "actor-multi-staff-one@example.com",
    });
    const secondOwner = await User.create({
      name: "Actor Multi Staff Owner Two",
      email: "actor-multi-staff-owner-two@example.com",
      password: "password123",
      role: "barber",
      isActive: true,
    });
    const secondBusiness = await Business.create({
      owner: secondOwner._id,
      name: "Actor Multi Staff Shop Two",
      contactInfo: { phone: "+34222222222" },
    });
    const secondStaff = await Staff.create({
      business: secondBusiness._id,
      firstName: "Multi",
      lastName: "Staff Two",
      email: "actor-multi-staff-two@example.com",
    });
    const staffUser = await User.create({
      name: "Actor Multi Staff User",
      email: "actor-multi-staff-user@example.com",
      password: "password123",
      role: "barber",
      isActive: true,
    });

    firstFixture.staff.user = staffUser._id;
    secondStaff.user = staffUser._id;
    await Promise.all([firstFixture.staff.save(), secondStaff.save()]);

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", authHeaderFor({ id: staffUser._id, role: "barber" }));

    expect(res.status).toBe(200);
    expect(res.body.data.actorContext).toMatchObject({
      actorType: "staff",
      userId: staffUser._id.toString(),
      businessId: null,
      staffId: null,
      legacyResolution: {
        type: "staff_user_link",
        field: "user",
      },
    });
    expect(res.body.data.actorContext.staffMemberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          staffId: firstFixture.staff._id.toString(),
          businessId: firstFixture.business._id.toString(),
          userId: staffUser._id.toString(),
        }),
        expect.objectContaining({
          staffId: secondStaff._id.toString(),
          businessId: secondBusiness._id.toString(),
          userId: staffUser._id.toString(),
        }),
      ])
    );
  });

  test("keeps /auth/me protected without token", async () => {
    const res = await request(app).get("/auth/me");

    expect(res.status).toBe(401);
  });
});
