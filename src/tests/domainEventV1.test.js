const request = require("supertest");
const app = require("../app");
const DomainEvent = require("../models/domainEvent");
const { recordDomainEvent } = require("../services/domainEventService");
const {
  createOperationalCommerceFixture,
  createPaymentCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

beforeAll(async () => {
  await DomainEvent.syncIndexes();
});

const buildFutureDate = (daysAhead = 7) => {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
};

describe("Domain event v1", () => {
  test("records an exact retry once without mutating the original event", async () => {
    const { fixture, checkout } = await createPaymentCommerceFixture({
      ownerEmail: "domain-retry-owner@example.com",
      businessName: "Domain Retry Shop",
    });
    const occurredAt = new Date("2026-04-26T10:00:00.000Z");

    const firstEvent = await recordDomainEvent({
      type: "payment_captured",
      actorId: fixture.owner._id,
      shopId: fixture.business._id,
      correlationId: checkout._id,
      occurredAt,
      payload: {
        paymentId: fixture.appointment._id,
        checkoutId: checkout._id,
        amount: 40,
      },
    });

    const retryEvent = await recordDomainEvent({
      type: "payment_captured",
      actorId: fixture.owner._id,
      shopId: fixture.business._id,
      correlationId: checkout._id,
      occurredAt: new Date("2026-04-26T10:05:00.000Z"),
      payload: {
        amount: 40,
        checkoutId: checkout._id,
        paymentId: fixture.appointment._id,
      },
    });

    const storedEvents = await DomainEvent.find({
      shopId: fixture.business._id,
      type: "payment_captured",
    }).lean();

    expect(storedEvents).toHaveLength(1);
    expect(retryEvent.eventId).toBe(firstEvent.eventId);
    expect(storedEvents[0].occurredAt.toISOString()).toBe(occurredAt.toISOString());
    expect(storedEvents[0].payload.amount).toBe(40);
    expect(storedEvents[0].idempotencyKey).toContain("payment_captured");
  });

  test("deduplicates concurrent attempts for the same domain event", async () => {
    const { fixture } = await createPaymentCommerceFixture({
      ownerEmail: "domain-concurrent-owner@example.com",
      businessName: "Domain Concurrent Shop",
    });
    const eventPayload = {
      appointmentId: fixture.appointment._id,
      clientId: fixture.client._id,
      serviceId: fixture.service._id,
      staffId: fixture.staff._id,
    };

    const events = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordDomainEvent({
          type: "service_started",
          actorId: fixture.owner._id,
          shopId: fixture.business._id,
          correlationId: fixture.appointment._id,
          payload: eventPayload,
        })
      )
    );

    const storedEvents = await DomainEvent.find({
      shopId: fixture.business._id,
      type: "service_started",
    }).lean();

    expect(storedEvents).toHaveLength(1);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(1);
  });

  test("keeps distinct events that share type and correlation but carry different payloads", async () => {
    const { fixture } = await createPaymentCommerceFixture({
      ownerEmail: "domain-distinct-owner@example.com",
      businessName: "Domain Distinct Shop",
    });

    await recordDomainEvent({
      type: "booking_modified",
      actorId: fixture.owner._id,
      shopId: fixture.business._id,
      correlationId: fixture.appointment._id,
      payload: {
        appointmentId: fixture.appointment._id,
        modifiedFields: ["startTime"],
        startTime: "10:00",
      },
    });

    await recordDomainEvent({
      type: "booking_modified",
      actorId: fixture.owner._id,
      shopId: fixture.business._id,
      correlationId: fixture.appointment._id,
      payload: {
        appointmentId: fixture.appointment._id,
        modifiedFields: ["startTime"],
        startTime: "11:00",
      },
    });

    const storedEvents = await DomainEvent.find({
      shopId: fixture.business._id,
      type: "booking_modified",
    }).lean();

    expect(storedEvents).toHaveLength(2);
  });

  test("requires correlation id for domain events", async () => {
    const { fixture } = await createPaymentCommerceFixture({
      ownerEmail: "domain-correlation-owner@example.com",
      businessName: "Domain Correlation Shop",
    });

    await expect(
      recordDomainEvent({
        type: "service_completed",
        actorId: fixture.owner._id,
        shopId: fixture.business._id,
        payload: {
          appointmentId: fixture.appointment._id,
        },
      })
    ).rejects.toThrow(/correlationId/);
  });

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
