const CreditProduct = require("../models/creditProduct");
const Business = require("../models/User/business");
const Payment = require("../models/payment");
const request = require("supertest");
const { createCommerceFixture } = require("./helpers/commerceFixture");
const {
  mockStripe,
  createWebhookResponse,
  createInvoicePaidEvent,
  createSubscriptionDeletedEvent,
  registerStripeBillingTestHooks,
} = require("./helpers/stripeBillingTestHelper");

jest.mock("../services/billing/stripeClient", () => mockStripe);

const app = require("../app");
const { handleStripeWebhook } = require("../controllers/webhookController");
const {
  getStripeWebhookSecretInfo,
  logStripeWebhookSecretMode,
} = require("../services/billing/stripeWebhookService");

registerStripeBillingTestHooks({ clearLegacyWebhookSecrets: true });

describe("Stripe webhook v1", () => {
  test("keeps /webhook/stripe as the only supported public webhook route", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_canonical";
    delete process.env.WEBHOOK_SECRET_ONE;
    delete process.env.WEBHOOK_SECRET_TWO;

    const stripeRes = await request(app)
      .post("/webhook/stripe")
      .set("stripe-signature", "sig_invalid")
      .set("Content-Type", "application/json")
      .send("{}");

    const legacyRes = await request(app)
      .post("/webhook")
      .set("stripe-signature", "sig_invalid")
      .set("Content-Type", "application/json")
      .send("{}");

    expect(stripeRes.status).toBe(400);
    expect(legacyRes.status).toBe(404);
  });

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

    const storedPayment = await Payment.findOne({
      business: fixture.business._id,
      paymentScope: "platform_billing",
      providerReference: "checkout_session:cs_credit",
    }).lean();

    expect(storedPayment).not.toBeNull();
    expect(storedPayment.method).toBe("stripe");
    expect(storedPayment.amount).toBe(49);
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

    mockStripe.webhooks.constructEvent.mockReturnValue(
      createSubscriptionDeletedEvent({
        subscriptionId: "sub_previous",
        customerId: "cus_previous",
        businessId: fixture.business._id.toString(),
      })
    );

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

  test("records invoice.paid once even when Stripe retries the same billing event", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Invoice Owner",
      ownerEmail: "stripe-invoice-owner@example.com",
      businessName: "Stripe Invoice Shop",
    });

    const invoiceEvent = createInvoicePaidEvent({
      eventId: "evt_invoice_paid_once",
      invoiceId: "in_paid_once",
      customerId: "cus_invoice",
      subscriptionId: "sub_invoice",
      businessId: fixture.business._id.toString(),
      amountPaid: 3900,
      currency: "eur",
      paidAt: 1776556800,
    });

    mockStripe.webhooks.constructEvent.mockReturnValue(invoiceEvent);

    const firstRes = createWebhookResponse();
    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_invoice_first" },
      },
      firstRes
    );

    const secondRes = createWebhookResponse();
    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_invoice_retry" },
      },
      secondRes
    );

    const storedPayments = await Payment.find({
      business: fixture.business._id,
      paymentScope: "platform_billing",
      providerReference: "invoice:in_paid_once",
    }).lean();

    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
    expect(firstRes.payload).toBe("Invoice payment recorded");
    expect(secondRes.payload).toBe("Invoice payment recorded");
    expect(storedPayments).toHaveLength(1);
    expect(storedPayments[0].amount).toBe(39);
    expect(storedPayments[0].currency).toBe("EUR");
    expect(storedPayments[0].providerSubscriptionId).toBe("sub_invoice");
  });
});
