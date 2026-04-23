const request = require("supertest");
const app = require("../app");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
  createClosedCheckoutForFixture,
} = require("./helpers/commerceFixture");

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("Checkout state contract v1", () => {
  const openCheckoutForFixture = (fixture) =>
    request(app)
      .post(`/checkout/appointment/${fixture.appointment._id}/open`)
      .set("Authorization", `Bearer ${fixture.token}`);

  test("rejects opening checkout for an appointment that is not completed", async () => {
    const fixture = await createCommerceFixture({
      ownerEmail: "checkout-state-owner@example.com",
      businessName: "Checkout State Shop",
      appointmentStatus: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "in_service",
    });

    const res = await openCheckoutForFixture(fixture);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/completed visit/i);
  });

  test("rejects opening checkout when the appointment already has a terminal checkout", async () => {
    const fixture = await createCommerceFixture({
      ownerEmail: "checkout-terminal-owner@example.com",
      businessName: "Checkout Terminal Shop",
      appointmentStatus: "Completed",
      bookingStatus: "confirmed",
      visitStatus: "completed",
    });

    const terminalCheckout = await createClosedCheckoutForFixture(fixture, {
      subtotal: 35,
      discountTotal: 0,
      tip: 5,
      total: 40,
      sourcePrice: 35,
    });

    terminalCheckout.status = "paid";
    await terminalCheckout.save();

    const res = await openCheckoutForFixture(fixture);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/terminal checkout already exists/i);
  });
});
