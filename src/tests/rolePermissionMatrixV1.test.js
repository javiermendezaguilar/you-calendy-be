const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const User = require("../models/User/user");
const Business = require("../models/User/business");
const {
  resolveCapabilitiesForActor,
} = require("../services/identity/rolePermissionMatrix");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");

const authHeaderFor = (payload) =>
  `Bearer ${jwt.sign(payload, process.env.JWT_SECRET)}`;

const clientAuthHeaderFor = (clientId, businessId) =>
  authHeaderFor({
    id: clientId,
    role: "client",
    type: "client",
    businessId: businessId.toString(),
  });

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("Role permission matrix v1", () => {
  test("keeps role-permissions protected without token", async () => {
    const res = await request(app).get("/auth/role-permissions");

    expect(res.status).toBe(401);
  });

  test("returns the complete v1 matrix and owner capabilities", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Permission Matrix Owner",
      ownerEmail: "permission-matrix-owner@example.com",
      businessName: "Permission Matrix Shop",
    });

    const res = await request(app)
      .get("/auth/role-permissions")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.matrixVersion).toBe("be-p1-27.v1");
    expect(Object.keys(res.body.data.roles)).toEqual(
      expect.arrayContaining([
        "owner",
        "manager",
        "reception",
        "barber",
        "client",
        "admin",
        "sub-admin",
      ])
    );
    expect(res.body.data.roles.manager.identityStatus).toBe("planned_identity");
    expect(res.body.data.roles.reception.identityStatus).toBe(
      "planned_identity"
    );
    expect(res.body.data.effectiveCapabilities).toMatchObject({
      effectiveRole: "owner",
      scope: "tenant",
      businessId: fixture.business._id.toString(),
    });
    expect(res.body.data.effectiveCapabilities.permissionKeys).toEqual(
      expect.arrayContaining([
        "tenant.payment.refund",
        "tenant.cash.close",
        "tenant.billing.manage",
      ])
    );
  });

  test("limits legacy staff users to barber capabilities", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Permission Staff Owner",
      ownerEmail: "permission-staff-owner@example.com",
      businessName: "Permission Staff Shop",
      staffEmail: "permission-staff@example.com",
    });
    const staffUser = await User.create({
      name: "Permission Staff User",
      email: fixture.staff.email,
      password: "password123",
      role: "barber",
      isActive: true,
    });

    const res = await request(app)
      .get("/auth/role-permissions")
      .set("Authorization", authHeaderFor({ id: staffUser._id, role: "barber" }));

    expect(res.status).toBe(200);
    expect(res.body.data.effectiveCapabilities).toMatchObject({
      effectiveRole: "barber",
      scope: "tenant_staff",
      businessId: fixture.business._id.toString(),
      staffId: fixture.staff._id.toString(),
    });
    expect(res.body.data.effectiveCapabilities.permissionKeys).toEqual(
      expect.arrayContaining(["tenant.appointments.own.operate"])
    );
    expect(res.body.data.effectiveCapabilities.permissionKeys).not.toContain(
      "tenant.payment.refund"
    );
    expect(res.body.data.effectiveCapabilities.permissionKeys).not.toContain(
      "tenant.cash.close"
    );
  });

  test("uses explicit staff user link for barber capabilities", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Permission Linked Staff Owner",
      ownerEmail: "permission-linked-staff-owner@example.com",
      businessName: "Permission Linked Staff Shop",
      staffEmail: "permission-linked-staff@example.com",
    });
    const staffUser = await User.create({
      name: "Permission Linked Staff User",
      email: "permission-linked-user@example.com",
      password: "password123",
      role: "barber",
      isActive: true,
    });
    fixture.staff.user = staffUser._id;
    await fixture.staff.save();

    const res = await request(app)
      .get("/auth/role-permissions")
      .set("Authorization", authHeaderFor({ id: staffUser._id, role: "barber" }));

    expect(res.status).toBe(200);
    expect(res.body.data.effectiveCapabilities).toMatchObject({
      effectiveRole: "barber",
      scope: "tenant_staff",
      businessId: fixture.business._id.toString(),
      staffId: fixture.staff._id.toString(),
    });
    expect(res.body.data.effectiveCapabilities.permissionKeys).toEqual(
      expect.arrayContaining(["tenant.appointments.own.operate"])
    );
    expect(res.body.data.effectiveCapabilities.permissionKeys).not.toContain(
      "tenant.payment.refund"
    );
  });

  test("limits clients to self-service capabilities", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Permission Client Owner",
      ownerEmail: "permission-client-owner@example.com",
      businessName: "Permission Client Shop",
    });

    const res = await request(app)
      .get("/auth/role-permissions")
      .set(
        "Authorization",
        clientAuthHeaderFor(fixture.client._id, fixture.business._id)
      );

    expect(res.status).toBe(200);
    expect(res.body.data.effectiveCapabilities).toMatchObject({
      effectiveRole: "client",
      scope: "client_self",
      businessId: fixture.business._id.toString(),
      clientId: fixture.client._id.toString(),
    });
    expect(res.body.data.effectiveCapabilities.permissionKeys).toEqual(
      expect.arrayContaining(["client.appointments.own.manage"])
    );
    expect(res.body.data.effectiveCapabilities.permissionKeys).not.toContain(
      "tenant.cash.close"
    );
    expect(res.body.data.effectiveCapabilities.permissionKeys).not.toContain(
      "tenant.reconciliation.read"
    );
  });

  test("treats an admin-owner hybrid as platform admin, not tenant owner", async () => {
    const admin = await User.create({
      name: "Hybrid Platform Admin",
      email: "hybrid-platform-admin@example.com",
      password: "password123",
      role: "admin",
      isActive: true,
    });
    const business = await Business.create({
      owner: admin._id,
      name: "Hybrid Admin Shop",
      contactInfo: { phone: "+34999999999" },
    });

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", authHeaderFor({ id: admin._id, role: "admin" }));

    expect(res.status).toBe(200);
    expect(res.body.data.actorContext).toMatchObject({
      actorType: "admin",
      businessId: null,
      isBusinessOwner: false,
      isPlatformAdmin: true,
      legacyResolution: {
        type: "platform_admin_owner_hybrid",
        decision: "platform_admin_takes_precedence",
        businessId: business._id.toString(),
      },
    });
    expect(res.body.data.actorContext.capabilities).toMatchObject({
      effectiveRole: "admin",
      scope: "platform",
    });
    expect(res.body.data.actorContext.capabilities.permissionKeys).toEqual(
      expect.arrayContaining(["platform.users.manage"])
    );
    expect(res.body.data.actorContext.capabilities.permissionKeys).not.toContain(
      "tenant.business.manage"
    );
    expect(res.body.data.actorContext.capabilities.permissionKeys).not.toContain(
      "tenant.payment.refund"
    );
  });

  test("normalizes legacy sub-admin permission levels without tenant escalation", () => {
    const capabilities = resolveCapabilitiesForActor({
      actorType: "sub-admin",
      permissions: ["complete access"],
    });

    expect(capabilities.legacyPermissions).toEqual(["complete access"]);
    expect(capabilities.permissionKeys).toEqual(
      expect.arrayContaining(["platform.users.manage"])
    );
    expect(capabilities.permissionKeys).not.toContain("tenant.payment.refund");
    expect(capabilities.permissionKeys).not.toContain("tenant.cash.close");
  });
});
