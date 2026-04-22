const CreditProduct = require("../models/creditProduct");
const Business = require("../models/User/business");
const { createCommerceFixture } = require("./helpers/commerceFixture");
const {
  mockStripe,
  createWebhookResponse,
  registerStripeBillingTestHooks,
} = require("./helpers/stripeBillingTestHelper");

jest.mock("../services/billing/stripeClient", () => mockStripe);

const { handleStripeWebhook } = require("../controllers/webhookController");
const {
  getStripeWebhookSecretInfo,
  logStripeWebhookSecretMode,
} = require("../services/billing/stripeWebhookService");

registerStripeBillingTestHooks({ clearLegacyWebhookSecrets: true });

describe("Stripe webhook v1", () => {
  test("resolves the canonical webhook secret before legacy fallbacks", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_canonical";
    process.env.WEBHOOK_SECRET_ONE = "whsec_legacy_one";
    process.env.WEBHOOK_SECRET_TWO = "whsec_legacy_two";

    expect(getStripeWebhookSecretInfo()).toEqual({
      value: "whsec_canonical",
      source: "STRIPE_WEBHOOK_SECRET",
      usesLegacyFallback: false,
    });
  });

  test("logs when the webhook runtime already uses the canonical secret", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_canonical";
    process.env.WEBHOOK_SECRET_ONE = "whsec_legacy_one";
    process.env.WEBHOOK_SECRET_TWO = "whsec_legacy_two";

    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const info = logStripeWebhookSecretMode(logger);

    expect(info).toEqual({
      value: "whsec_canonical",
      source: "STRIPE_WEBHOOK_SECRET",
      usesLegacyFallback: false,
    });
    expect(logger.log).toHaveBeenCalledWith(
      "Stripe webhook secret source: STRIPE_WEBHOOK_SECRET"
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("does not resolve legacy webhook secrets when canonical config is missing", () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET_ONE = "whsec_legacy_one";
    delete process.env.WEBHOOK_SECRET_TWO;

    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const info = logStripeWebhookSecretMode(logger);

    expect(info).toEqual({
      value: "",
      source: null,
      usesLegacyFallback: false,
    });
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Stripe webhook secret is not configured"
    );
  });

  test("rejects the webhook when only a legacy secret exists in the environment", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET_ONE = "whsec_legacy_one";

    const res = createWebhookResponse();

    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_legacy_only" },
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.payload).toBe("Webhook secret not configured");
  });

  test("adds credits for a successful credit purchase checkout", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Credits Owner",
      ownerEmail: "stripe-credits-owner@example.com",
      businessName: "Stripe Credits Shop",
    });

    await CreditProduct.create({
      title: "Credit Pack",
      amount: 49,
      currency: "eur",
      smsCredits: 120,
      emailCredits: 45,
      stripeProductId: "prod_credits",
      stripePriceId: "price_credits",
      isActive: true,
    });

    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_credit",
          metadata: {
            type: "credit_purchase",
            businessId: fixture.business._id.toString(),
            ownerId: fixture.owner._id.toString(),
          },
        },
      },
    });
    mockStripe.checkout.sessions.listLineItems.mockResolvedValue({
      data: [{ price: { id: "price_credits" } }],
    });

    const res = createWebhookResponse();

    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_credits" },
      },
      res
    );

    const updatedBusiness = await Business.findById(fixture.business._id).lean();

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("Credits added successfully");
    expect(updatedBusiness.smsCredits).toBe(120);
    expect(updatedBusiness.emailCredits).toBe(45);
    expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
      expect.any(Buffer),
      "sig_credits",
      "whsec_canonical"
    );
  });

  test("activates a subscription from checkout session completion", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Subscription Owner",
      ownerEmail: "stripe-sub-owner@example.com",
      businessName: "Stripe Subscription Shop",
    });

    fixture.business.subscriptionStatus = "trialing";
    fixture.business.trialStart = new Date("2026-04-01T00:00:00.000Z");
    fixture.business.trialEnd = new Date("2026-04-15T00:00:00.000Z");
    await fixture.business.save();

    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_subscription",
          mode: "subscription",
          subscription: "sub_active",
          metadata: {
            businessId: fixture.business._id.toString(),
          },
        },
      },
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_active",
      status: "active",
      customer: "cus_active",
      metadata: {},
    });

    const res = createWebhookResponse();

    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_subscription" },
      },
      res
    );

    const updatedBusiness = await Business.findById(fixture.business._id).lean();

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("Subscription activated");
    expect(updatedBusiness.subscriptionStatus).toBe("active");
    expect(updatedBusiness.stripeSubscriptionId).toBe("sub_active");
    expect(updatedBusiness.stripeCustomerId).toBe("cus_active");
    expect(updatedBusiness.trialStart).toBeNull();
    expect(updatedBusiness.trialEnd).toBeNull();
  });

  test("marks the business subscription as canceled on deletion events", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Cancel Owner",
      ownerEmail: "stripe-cancel-owner@example.com",
      businessName: "Stripe Cancel Shop",
    });

    fixture.business.subscriptionStatus = "active";
    fixture.business.stripeSubscriptionId = "sub_previous";
    fixture.business.stripeCustomerId = "cus_previous";
    await fixture.business.save();

    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_previous",
          status: "canceled",
          customer: "cus_previous",
          metadata: {
            businessId: fixture.business._id.toString(),
          },
        },
      },
    });

    const res = createWebhookResponse();

    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_canceled" },
      },
      res
    );

    const updatedBusiness = await Business.findById(fixture.business._id).lean();

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("Subscription canceled");
    expect(updatedBusiness.subscriptionStatus).toBe("canceled");
    expect(updatedBusiness.stripeSubscriptionId).toBe("sub_previous");
  });
});
