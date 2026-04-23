const request = require("supertest");
const app = require("../app");
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

describe("Checkout state contract v1", () => {
  test("rejects opening checkout for an appointment that is not completed", async () => {
    const fixture = await createCommerceFixture({
      ownerEmail: "checkout-state-owner@example.com",
      businessName: "Checkout State Shop",
      appointmentStatus: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "in_service",
    });

    const res = await request(app)
      .post(`/checkout/appointment/${fixture.appointment._id}/open`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/completed visit/i);
  });
});
