jest.mock("../instrument", () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

const mongoose = require("mongoose");
const DomainEvent = require("../models/domainEvent");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");
const {
  BUSINESS_OBSERVABILITY_EVENT_TYPE,
  recordBusinessSignal,
} = require("../services/businessObservabilityService");
const { deductSmsCredits } = require("../utils/creditManager");
const Sentry = require("../instrument");

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("business observability v1", () => {
  test("records an idempotent business signal with sanitized metadata", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Observability Owner",
      ownerEmail: "observability-owner@example.com",
      businessName: "Observability Shop",
    });

    const payload = {
      signalType: "credit_deduction_rejected",
      severity: "warning",
      businessId: fixture.business._id,
      actorId: fixture.owner._id,
      source: "test",
      correlationId: "credit-deduction-rejected:test:idempotent",
      action: "deduct_rejected",
      reason: "insufficient_credits",
      entityType: "credit_balance",
      entityId: "sms",
      metadata: {
        visible: "kept",
        password: "do-not-store",
        nested: {
          apiKey: "do-not-store",
          amount: 1,
        },
      },
    };

    const firstResult = await recordBusinessSignal(payload);
    const retryResult = await recordBusinessSignal(payload);

    const storedEvents = await DomainEvent.find({
      type: BUSINESS_OBSERVABILITY_EVENT_TYPE,
    }).lean();

    expect(firstResult.domainEventRecorded).toBe(true);
    expect(retryResult.domainEventRecorded).toBe(true);
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0].payload).toMatchObject({
      signalType: "credit_deduction_rejected",
      severity: "warning",
      action: "deduct_rejected",
      reason: "insufficient_credits",
      entityType: "credit_balance",
      entityId: "sms",
    });
    expect(storedEvents[0].payload.metadata.visible).toBe("kept");
    expect(storedEvents[0].payload.metadata.password).toBe("[redacted]");
    expect(storedEvents[0].payload.metadata.nested.apiKey).toBe("[redacted]");
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
  });

  test("does not block when the business actor cannot be resolved", async () => {
    await createCommerceFixture({
      ownerName: "Missing Actor Owner",
      ownerEmail: "missing-actor-owner@example.com",
      businessName: "Missing Actor Shop",
    });

    const result = await recordBusinessSignal({
      signalType: "stripe_webhook_outcome",
      severity: "error",
      businessId: new mongoose.Types.ObjectId(),
      source: "stripe_webhook",
      correlationId: "evt_missing_business",
      reason: "business_not_resolved",
      metadata: {
        eventType: "invoice.paid",
      },
    });

    const storedEvents = await DomainEvent.find({
      type: BUSINESS_OBSERVABILITY_EVENT_TYPE,
    }).lean();

    expect(result.domainEventRecorded).toBe(false);
    expect(result.domainEventReason).toBe("actor_not_resolved");
    expect(storedEvents).toHaveLength(0);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  test("credit manager emits business signals for deducted and rejected credits", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Credit Signal Owner",
      ownerEmail: "credit-signal-owner@example.com",
      businessName: "Credit Signal Shop",
    });

    fixture.business.smsCredits = 1;
    await fixture.business.save();

    await deductSmsCredits(fixture.business._id, 1);
    await expect(deductSmsCredits(fixture.business._id, 1)).rejects.toThrow(
      "Insufficient SMS credits"
    );

    const deductedEvent = await DomainEvent.findOne({
      type: BUSINESS_OBSERVABILITY_EVENT_TYPE,
      "payload.signalType": "credit_deducted",
      shopId: fixture.business._id,
    }).lean();
    const rejectedEvent = await DomainEvent.findOne({
      type: BUSINESS_OBSERVABILITY_EVENT_TYPE,
      "payload.signalType": "credit_deduction_rejected",
      shopId: fixture.business._id,
    }).lean();

    expect(deductedEvent).toBeTruthy();
    expect(deductedEvent.payload.metadata).toMatchObject({
      creditType: "sms",
      action: "deducted",
      credits: 1,
      remainingCredits: 0,
    });
    expect(rejectedEvent).toBeTruthy();
    expect(rejectedEvent.payload).toMatchObject({
      severity: "warning",
      reason: "insufficient_credits",
    });
    expect(rejectedEvent.payload.metadata).toMatchObject({
      creditType: "sms",
      action: "deduct_rejected",
      credits: 1,
      currentCredits: 0,
    });
  });
});
