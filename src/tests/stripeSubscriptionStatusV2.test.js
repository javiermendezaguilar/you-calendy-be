const request = require("supertest");
const Business = require("../models/User/business");
const { createCommerceFixture } = require("./helpers/commerceFixture");
const {
  mockStripe,
  createWebhookResponse,
  createSubscriptionDeletedEvent,
  registerStripeBillingTestHooks,
} = require("./helpers/stripeBillingTestHelper");

jest.mock("../services/billing/stripeClient", () => mockStripe);

const app = require("../app");
const { handleStripeWebhook } = require("../controllers/webhookController");

registerStripeBillingTestHooks();

describe("Stripe subscription status v2", () => {
  test("reconciles GET /business/subscription-status from Stripe when local state is stale", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Reconcile Owner",
      ownerEmail: "stripe-reconcile-owner@example.com",
      businessName: "Stripe Reconcile Shop",
    });

    fixture.business.trialUsed = true;
    fixture.business.trialStart = new Date("2026-04-01T00:00:00.000Z");
    fixture.business.trialEnd = new Date("2026-04-20T00:00:00.000Z");
    fixture.business.subscriptionStatus = "trialing";
    fixture.business.stripeSubscriptionId = "sub_live";
    fixture.business.stripeCustomerId = "cus_live";
    await fixture.business.save();

    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_live",
      status: "active",
      customer: "cus_live",
      metadata: {
        businessId: fixture.business._id.toString(),
      },
    });

    const res = await request(app)
      .get("/business/subscription-status")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.source).toBe("stripe");

    const updatedBusiness = await Business.findById(fixture.business._id).lean();
    expect(updatedBusiness.subscriptionStatus).toBe("active");
    expect(updatedBusiness.trialStart).toBeNull();
    expect(updatedBusiness.trialEnd).toBeNull();
  });

  test("ignores stale lifecycle events from an old subscription id", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Stale Owner",
      ownerEmail: "stripe-stale-owner@example.com",
      businessName: "Stripe Stale Shop",
    });

    fixture.business.subscriptionStatus = "active";
    fixture.business.stripeSubscriptionId = "sub_current";
    fixture.business.stripeCustomerId = "cus_current";
    await fixture.business.save();

    mockStripe.webhooks.constructEvent.mockReturnValue(
      createSubscriptionDeletedEvent({
        subscriptionId: "sub_old",
        customerId: "cus_old",
        businessId: fixture.business._id.toString(),
      })
    );

    const res = createWebhookResponse();

    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_old_subscription" },
      },
      res
    );

    const updatedBusiness = await Business.findById(fixture.business._id).lean();

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("Stale subscription event ignored");
    expect(updatedBusiness.subscriptionStatus).toBe("active");
    expect(updatedBusiness.stripeSubscriptionId).toBe("sub_current");
    expect(updatedBusiness.stripeCustomerId).toBe("cus_current");
  });

  test("rejects invalid create-subscription payloads through runtime validation", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Validate Owner",
      ownerEmail: "stripe-validate-owner@example.com",
      businessName: "Stripe Validate Shop",
    });

    const res = await request(app)
      .post("/business/create-subscription")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ priceId: 123 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expected string|priceId/i);
  });
});
