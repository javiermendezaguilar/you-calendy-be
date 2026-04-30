const request = require("supertest");

const {
  connectCommerceTestDatabase,
  createCommerceFixture,
  disconnectCommerceTestDatabase,
  syncPrimaryServiceOnBusiness,
} = require("./helpers/commerceFixture");

const app = require("../app");
const Business = require("../models/User/business");
const Service = require("../models/service");

jest.setTimeout(30000);

const waitForCommerceTestServerCleanup = () =>
  new Promise((resolve) => setTimeout(resolve, 1100));

describe("Service input validation v1", () => {
  beforeAll(async () => {
    await connectCommerceTestDatabase();
  });

  afterAll(async () => {
    await disconnectCommerceTestDatabase();
    await waitForCommerceTestServerCleanup();
  });

  test("rejects invalid public service filters and ids before Mongo casts", async () => {
    const invalidListRes = await request(app)
      .get("/services")
      .query({ businessId: "not-an-id" });

    expect(invalidListRes.status).toBe(400);

    const invalidCategoriesRes = await request(app)
      .get("/services/categories")
      .query({ businessId: "not-an-id" });

    expect(invalidCategoriesRes.status).toBe(400);

    const invalidReadRes = await request(app).get("/services/not-an-id");

    expect(invalidReadRes.status).toBe(400);
  });

  test("rejects invalid owner service creation without mutating catalog or shadow", async () => {
    const fixture = await createCommerceFixture({
      ownerEmail: "services-input-create@example.com",
    });
    const countBefore = await Service.countDocuments({
      business: fixture.business._id,
    });

    const res = await request(app)
      .post("/business/services")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        name: "Broken Service",
        price: "free",
        duration: "fast",
        currency: "DOGE",
      });

    expect(res.status).toBe(400);

    const countAfter = await Service.countDocuments({
      business: fixture.business._id,
    });
    expect(countAfter).toBe(countBefore);

    const refreshedBusiness = await Business.findById(
      fixture.business._id
    ).lean();
    expect(refreshedBusiness.services || []).toHaveLength(0);
  });

  test("rejects invalid owner service updates before mutating canonical service", async () => {
    const fixture = await createCommerceFixture({
      ownerEmail: "services-input-owner-update@example.com",
      servicePrice: 35,
    });

    const invalidIdRes = await request(app)
      .put("/business/services/not-an-id")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ name: "Valid Name" });

    expect(invalidIdRes.status).toBe(400);

    const invalidBodyRes = await request(app)
      .put(`/business/services/${fixture.service._id}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ isActive: "maybe" });

    expect(invalidBodyRes.status).toBe(400);

    const unchangedService = await Service.findById(fixture.service._id).lean();
    expect(unchangedService.price).toBe(35);
    expect(unchangedService.isActive).toBe(true);
  });

  test("rejects invalid legacy service updates without changing shadow data", async () => {
    const fixture = await createCommerceFixture({
      ownerEmail: "services-input-legacy-update@example.com",
      servicePrice: 30,
    });
    await syncPrimaryServiceOnBusiness(fixture.business, fixture.service);

    const res = await request(app)
      .put(`/services/${fixture.service._id}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ price: -1, isActive: "sometimes" });

    expect(res.status).toBe(400);

    const unchangedService = await Service.findById(fixture.service._id).lean();
    expect(unchangedService.price).toBe(30);

    const refreshedBusiness = await Business.findById(
      fixture.business._id
    ).lean();
    expect(refreshedBusiness.services[0].price).toBe(30);
  });

  test("validates legacy service delete id and reason before deletion", async () => {
    const fixture = await createCommerceFixture({
      ownerEmail: "services-input-delete@example.com",
    });

    const invalidIdRes = await request(app)
      .delete("/services/not-an-id")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ reason: "cleanup" });

    expect(invalidIdRes.status).toBe(400);

    const missingReasonRes = await request(app)
      .delete(`/services/${fixture.service._id}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(missingReasonRes.status).toBe(400);

    const serviceStillExists = await Service.exists({ _id: fixture.service._id });
    expect(serviceStillExists).toBeTruthy();
  });
});
