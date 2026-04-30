const jwt = require("jsonwebtoken");
const request = require("supertest");

const app = require("../app");
const ApiKey = require("../models/apiKey");
const Auditing = require("../models/auditing");
const Backup = require("../models/backup");
const Business = require("../models/User/business");
const Client = require("../models/client");
const Plan = require("../models/plan");
const User = require("../models/User/user");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

const authHeaderFor = (user) =>
  `Bearer ${jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET)}`;

const createUser = (overrides = {}) =>
  User.create({
    name: overrides.name || "Admin Input User",
    email: overrides.email || `admin-input-${Date.now()}@example.com`,
    password: "password123",
    role: overrides.role || "admin",
    isActive: true,
  });

describe("Admin input validation v1", () => {
  beforeEach(async () => {
    await Promise.all([
      ApiKey.deleteMany({}),
      Auditing.deleteMany({}),
      Backup.deleteMany({}),
      Business.deleteMany({}),
      Client.deleteMany({}),
      Plan.deleteMany({}),
      User.deleteMany({}),
    ]);
  });

  test("rejects malformed admin ids and filters before Mongo casts", async () => {
    const admin = await createUser({ email: "admin-input-filters@example.com" });
    const adminAuth = authHeaderFor(admin);

    const invalidBackupIdRes = await request(app)
      .get("/admin/backup/not-an-id")
      .set("Authorization", adminAuth);
    expect(invalidBackupIdRes.status).toBe(400);

    const invalidAuditFiltersRes = await request(app)
      .get("/admin/audit-logs")
      .query({
        page: 0,
        limit: 101,
        entityType: "Billing",
        action: "removed",
      })
      .set("Authorization", adminAuth);
    expect(invalidAuditFiltersRes.status).toBe(400);

    const invalidAuditIdRes = await request(app)
      .delete("/admin/audit-logs/not-an-id")
      .set("Authorization", adminAuth);
    expect(invalidAuditIdRes.status).toBe(400);

    const invalidStatsYearRes = await request(app)
      .get("/admin/stats/top-barbers")
      .query({ year: 1700 })
      .set("Authorization", adminAuth);
    expect(invalidStatsYearRes.status).toBe(400);

    const invalidRevenueGroupRes = await request(app)
      .get("/admin/stats/revenue-projection")
      .query({ groupBy: "quarter" })
      .set("Authorization", adminAuth);
    expect(invalidRevenueGroupRes.status).toBe(400);

    await expect(Backup.countDocuments()).resolves.toBe(0);
    await expect(Auditing.countDocuments()).resolves.toBe(0);
  });

  test("rejects invalid admin mutation payloads without changing data", async () => {
    const admin = await createUser({ email: "admin-input-mutations@example.com" });
    const adminAuth = authHeaderFor(admin);
    const business = await Business.create({
      owner: admin._id,
      name: "Admin Input Shop",
      contactInfo: { phone: "+34999999999" },
    });
    const client = await Client.create({
      business: business._id,
      firstName: "Ada",
      lastName: "Client",
      phone: "+34111111111",
      status: "activated",
      isActive: true,
    });

    const invalidEmailRes = await request(app)
      .post("/admin/send-email")
      .set("Authorization", adminAuth)
      .send({ recipientGroup: "everyone", message: "" });
    expect(invalidEmailRes.status).toBe(400);

    const invalidStatusRes = await request(app)
      .patch(`/admin/clients/${client._id}/status`)
      .set("Authorization", adminAuth)
      .send({ status: "paused" });
    expect(invalidStatusRes.status).toBe(400);

    const invalidProfileIdRes = await request(app)
      .put("/admin/clients/not-an-id")
      .set("Authorization", adminAuth)
      .send({ firstName: "Grace" });
    expect(invalidProfileIdRes.status).toBe(400);

    const massAssignmentRes = await request(app)
      .put(`/admin/clients/${client._id}`)
      .set("Authorization", adminAuth)
      .send({ business: "not-an-id" });
    expect(massAssignmentRes.status).toBe(400);

    const invalidBackupCreateRes = await request(app)
      .post("/admin/backup")
      .set("Authorization", adminAuth)
      .send({ type: "hourly", format: "zip" });
    expect(invalidBackupCreateRes.status).toBe(400);

    const invalidCleanupRes = await request(app)
      .post("/admin/backup/cleanup")
      .set("Authorization", adminAuth)
      .send({ maxAgeInDays: -1 });
    expect(invalidCleanupRes.status).toBe(400);

    const unchangedClient = await Client.findById(client._id).lean();
    expect(unchangedClient.status).toBe("activated");
    expect(unchangedClient.business.toString()).toBe(business._id.toString());
    await expect(Backup.countDocuments()).resolves.toBe(0);
  });

  test("requires platform admin and validates API key payloads", async () => {
    const barber = await createUser({
      email: "api-keys-barber@example.com",
      role: "barber",
    });
    const admin = await createUser({ email: "api-keys-admin@example.com" });

    const nonAdminRes = await request(app)
      .get("/admin/api-keys")
      .set("Authorization", authHeaderFor(barber));
    expect(nonAdminRes.status).toBe(403);

    const invalidBodyRes = await request(app)
      .put("/admin/api-keys")
      .set("Authorization", authHeaderFor(admin))
      .send({ metadata: { source: "test" } });
    expect(invalidBodyRes.status).toBe(400);

    await expect(ApiKey.countDocuments()).resolves.toBe(0);
  });

  test("validates plan ids and admin plan payloads before Stripe or Mongo writes", async () => {
    const admin = await createUser({ email: "plans-admin@example.com" });
    const adminAuth = authHeaderFor(admin);

    const invalidPublicReadRes = await request(app).get("/plans/not-an-id");
    expect(invalidPublicReadRes.status).toBe(400);

    const adminListRes = await request(app)
      .get("/plans/admin/all")
      .set("Authorization", adminAuth);
    expect(adminListRes.status).toBe(200);
    expect(adminListRes.body.data).toEqual([]);

    const invalidCreateRes = await request(app)
      .post("/plans")
      .set("Authorization", adminAuth)
      .send({
        title: "Broken",
        description: "Broken plan",
        amount: "free",
        features: [],
      });
    expect(invalidCreateRes.status).toBe(400);

    const invalidUpdateRes = await request(app)
      .put("/plans/not-an-id")
      .set("Authorization", adminAuth)
      .send({ amount: 10 });
    expect(invalidUpdateRes.status).toBe(400);

    const invalidDeleteRes = await request(app)
      .delete("/plans/not-an-id")
      .set("Authorization", adminAuth);
    expect(invalidDeleteRes.status).toBe(400);

    await expect(Plan.countDocuments()).resolves.toBe(0);
  });
});
