const request = require("supertest");
const app = require("../app");
const {
  createOperationalCommerceFixture,
  createPaymentCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

const buildFutureDate = (daysAhead = 7) => {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
};

describe("Domain event v1", () => {
  test("records checkout, payment, refund and rebooking events and exposes them by business", async () => {
    const fixture = await createOperationalCommerceFixture({
      appointmentStatus: "Completed",
      visitStatus: "completed",
    }, {
      staffTimeInterval: 45,
    });

    const openCheckoutRes = await request(app)
      .post(`/checkout/appointment/${fixture.appointment._id}/open`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(openCheckoutRes.status).toBe(201);
    const checkoutId = openCheckoutRes.body.data._id;

    const closeCheckoutRes = await request(app)
      .post(`/checkout/${checkoutId}/close`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ tip: 5 });

    expect(closeCheckoutRes.status).toBe(200);

    const captureRes = await request(app)
      .post(`/payment/checkout/${checkoutId}/capture`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        method: "card_manual",
        amount: 40,
        reference: "domain-event-capture",
      });

    expect(captureRes.status).toBe(201);
    const paymentId = captureRes.body.data._id;

    const rebookRes = await request(app)
      .post(`/checkout/${checkoutId}/rebook`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        date: buildFutureDate(),
        startTime: "12:00",
      });

    expect(rebookRes.status).toBe(201);

    const refundRes = await request(app)
      .post(`/payment/${paymentId}/refund`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        amount: 10,
        reason: "partial-refund",
      });

    expect(refundRes.status).toBe(201);

    const eventsRes = await request(app)
      .get("/business/domain-events")
      .set("Authorization", `Bearer ${fixture.token}`)
      .query({ limit: 10 });

    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.data.total).toBeGreaterThanOrEqual(5);
    expect(eventsRes.body.data.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "checkout_opened",
        "checkout_closed",
        "payment_captured",
        "payment_refunded",
        "rebook_created",
      ])
    );
  });

  test("records void events and supports filtering by type", async () => {
    const { fixture, checkout, token } = await createPaymentCommerceFixture();

    const captureRes = await request(app)
      .post(`/payment/checkout/${checkout._id}/capture`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        method: "card_manual",
        amount: 40,
        reference: "domain-event-void",
      });

    expect(captureRes.status).toBe(201);
    const paymentId = captureRes.body.data._id;

    const voidRes = await request(app)
      .post(`/payment/${paymentId}/void`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "operator-error",
      });

    expect(voidRes.status).toBe(200);

    const eventsRes = await request(app)
      .get("/business/domain-events")
      .set("Authorization", `Bearer ${token}`)
      .query({ type: "payment_voided", limit: 5 });

    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.data.events).toHaveLength(1);
    expect(eventsRes.body.data.events[0].type).toBe("payment_voided");
    expect(eventsRes.body.data.events[0].payload.paymentId.toString()).toBe(
      paymentId.toString()
    );
    expect(eventsRes.body.data.events[0].payload.reason).toBe("operator-error");
    expect(eventsRes.body.data.events[0].shopId.toString()).toBe(
      fixture.business._id.toString()
    );
  });
});
