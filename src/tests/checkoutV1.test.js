const request = require("supertest");
const app = require("../app");
const Checkout = require("../models/checkout");
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

describe("Checkout v1", () => {
  let appointment;
  let token;

  beforeEach(async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Checkout Owner",
      ownerEmail: "checkout-owner@example.com",
      businessName: "Checkout Shop",
      appointmentStatus: "Confirmed",
    });

    appointment = fixture.appointment;
    token = fixture.token;
  });

  test("opens a checkout from an appointment and persists audited amounts", async () => {
    const openRes = await request(app)
      .post(`/checkout/appointment/${appointment._id}/open`)
      .set("Authorization", `Bearer ${token}`);

    expect(openRes.status).toBe(201);
    expect(openRes.body.data.status).toBe("open");
    expect(openRes.body.data.subtotal).toBe(35);
    expect(openRes.body.data.discountTotal).toBe(15);
    expect(openRes.body.data.total).toBe(35);
    expect(openRes.body.data.sourcePrice).toBe(50);
    expect(openRes.body.data.snapshot.service.name).toBe("Signature Cut");
    expect(openRes.body.data.snapshot.client.firstName).toBe("John");

    const storedCheckout = await Checkout.findOne({
      appointment: appointment._id,
    }).lean();
    expect(storedCheckout).not.toBeNull();
    expect(storedCheckout.currency).toBe("EUR");
    expect(storedCheckout.snapshot.discounts.promotion.amount).toBe(10);
    expect(storedCheckout.snapshot.discounts.flashSale.amount).toBe(5);
  });

  test("rejects a duplicate open checkout for the same appointment", async () => {
    const firstOpenRes = await request(app)
      .post(`/checkout/appointment/${appointment._id}/open`)
      .set("Authorization", `Bearer ${token}`);

    expect(firstOpenRes.status).toBe(201);

    const duplicateRes = await request(app)
      .post(`/checkout/appointment/${appointment._id}/open`)
      .set("Authorization", `Bearer ${token}`);

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.message).toMatch(/open checkout already exists/i);
  });

  test("closes a checkout with tip and allows reading it by appointment", async () => {
    const openRes = await request(app)
      .post(`/checkout/appointment/${appointment._id}/open`)
      .set("Authorization", `Bearer ${token}`);

    const checkoutId = openRes.body.data._id;

    const closeRes = await request(app)
      .post(`/checkout/${checkoutId}/close`)
      .set("Authorization", `Bearer ${token}`)
      .send({ tip: 7 });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe("closed");
    expect(closeRes.body.data.tip).toBe(7);
    expect(closeRes.body.data.total).toBe(42);
    expect(closeRes.body.data.closedBy.email).toBe("checkout-owner@example.com");

    const byAppointmentRes = await request(app)
      .get(`/checkout/appointment/${appointment._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(byAppointmentRes.status).toBe(200);
    expect(byAppointmentRes.body.data._id).toBe(checkoutId);
    expect(byAppointmentRes.body.data.status).toBe("closed");
  });
});
