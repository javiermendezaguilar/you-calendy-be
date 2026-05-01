const request = require("supertest");

const app = require("../app");
const Client = require("../models/client");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");

describe("BE-P2-05 client list pagination, filters and order", () => {
  let fixture;

  beforeAll(async () => {
    await connectCommerceTestDatabase();
  });

  afterAll(async () => {
    await disconnectCommerceTestDatabase();
    await new Promise((resolve) => {
      setTimeout(resolve, 1100);
    });
  });

  beforeEach(async () => {
    fixture = await createCommerceFixture();
  });

  const getClients = (query = "") =>
    request(app)
      .get(`/business/clients${query}`)
      .set("Authorization", `Bearer ${fixture.token}`);

  test("rejects invalid pagination and sort query before listing clients", async () => {
    const invalidPage = await getClients("?page=0");
    expect(invalidPage.status).toBe(400);
    expect(invalidPage.body.success).toBe(false);

    const invalidSort = await getClients("?sort=__proto__:desc");
    expect(invalidSort.status).toBe(400);
    expect(invalidSort.body.success).toBe(false);
  });

  test("returns deterministic order with pagination metadata", async () => {
    const created = await Client.insertMany([
      {
        business: fixture.business._id,
        firstName: "Ana",
        lastName: "Zulu",
        phone: "+34600000001",
        createdAt: new Date("2026-01-02T10:00:00.000Z"),
      },
      {
        business: fixture.business._id,
        firstName: "Ana",
        lastName: "Alpha",
        phone: "+34600000002",
        createdAt: new Date("2026-01-03T10:00:00.000Z"),
      },
    ]);

    const res = await getClients("?sort=firstName:asc&page=1&limit=2");

    expect(res.status).toBe(200);
    expect(res.body.data.pagination).toMatchObject({
      total: 3,
      page: 1,
      limit: 2,
      pages: 2,
      hasMore: true,
    });

    const expectedAnaIds = created
      .map((client) => client._id.toString())
      .sort();
    const returnedAnaIds = res.body.data.clients
      .filter((client) => client.firstName === "Ana")
      .map((client) => client._id.toString());

    expect(returnedAnaIds).toEqual(expectedAnaIds);
  });

  test("supports boolean filters after validation coercion", async () => {
    await Client.create({
      business: fixture.business._id,
      firstName: "Inactive",
      lastName: "Client",
      phone: "+34600000003",
      isActive: false,
    });

    const res = await getClients("?isActive=false&limit=10");

    expect(res.status).toBe(200);
    expect(res.body.data.clients).toHaveLength(1);
    expect(res.body.data.clients[0].firstName).toBe("Inactive");
    expect(res.body.data.clients[0].isActive).toBe(false);
  });

  test("can skip total count while keeping page, limit and hasMore", async () => {
    await Client.insertMany([
      {
        business: fixture.business._id,
        firstName: "Countless",
        lastName: "One",
        phone: "+34600000004",
      },
      {
        business: fixture.business._id,
        firstName: "Countless",
        lastName: "Two",
        phone: "+34600000005",
      },
    ]);

    const res = await getClients("?includeCount=false&page=1&limit=2");

    expect(res.status).toBe(200);
    expect(res.body.data.pagination).toMatchObject({
      total: null,
      page: 1,
      limit: 2,
      pages: null,
      hasMore: true,
    });
  });
});
