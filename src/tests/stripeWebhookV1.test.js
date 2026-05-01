const CreditProduct = require("../models/creditProduct");
const Business = require("../models/User/business");
const Payment = require("../models/payment");
const DomainEvent = require("../models/domainEvent");
const request = require("supertest");
const { createCommerceFixture } = require("./helpers/commerceFixture");
const logger = require("../functions/logger");
const {
  mockStripe,
  createWebhookResponse,
  createInvoicePaidEvent,
  createInvoicePaymentFailedEvent,
  createInvoiceVoidedEvent,
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
const {
  BUSINESS_OBSERVABILITY_EVENT_TYPE,
} = require("../services/businessObservabilityService");

registerStripeBillingTestHooks({ clearLegacyWebhookSecrets: true });

const handleWebhookAndCaptureOutcome = async (signature) => {
  const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
  const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
  const res = createWebhookResponse();

  await handleStripeWebhook(
    {
      rawBody: Buffer.from("{}"),
      headers: { "stripe-signature": signature },
    },
    res
  );

  const outcomeCall = [...infoSpy.mock.calls, ...warnSpy.mock.calls].find(
    (call) => call[0]?.signalType === "stripe_webhook_outcome"
  );
  infoSpy.mockRestore();
  warnSpy.mockRestore();

  return {
    res,
    outcome: outcomeCall?.[0] || null,
  };
};

describe("Stripe webhook v1", () => {
  test("records structured outcome metadata for invoice.paid", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Outcome Owner",
      ownerEmail: "stripe-outcome-owner@example.com",
      businessName: "Stripe Outcome Shop",
    });

    const invoiceEvent = createInvoicePaidEvent({
      eventId: "evt_invoice_paid_observed",
      invoiceId: "in_paid_observed",
      customerId: "cus_observed",
      subscriptionId: "sub_observed",
      businessId: fixture.business._id.toString(),
      amountPaid: 2500,
      currency: "eur",
      paidAt: 1776556800,
    });

    mockStripe.webhooks.constructEvent.mockReturnValue(invoiceEvent);

    const res = createWebhookResponse();
    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_invoice_observed" },
      },
      res
    );

    const outcomeEvent = await DomainEvent.findOne({
      type: BUSINESS_OBSERVABILITY_EVENT_TYPE,
      correlationId: "evt_invoice_paid_observed",
      shopId: fixture.business._id,
    }).lean();

    expect(res.statusCode).toBe(200);
    expect(outcomeEvent).toBeTruthy();
    expect(outcomeEvent.payload).toMatchObject({
      signalType: "stripe_webhook_outcome",
      severity: "info",
      action: "processed",
      reason: "Invoice payment recorded",
    });
    expect(outcomeEvent.payload.metadata).toMatchObject({
      eventId: "evt_invoice_paid_observed",
      eventType: "invoice.paid",
      businessId: fixture.business._id.toString(),
      providerReference: "invoice:in_paid_observed",
    });
  });

  test("logs when a stale subscription event is ignored", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Stale Owner",
      ownerEmail: "stripe-stale-owner@example.com",
      businessName: "Stripe Stale Shop",
    });

    fixture.business.subscriptionStatus = "active";
    fixture.business.stripeSubscriptionId = "sub_canonical";
    fixture.business.stripeCustomerId = "cus_canonical";
    await fixture.business.save();

    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_stale",
          status: "active",
          customer: "cus_stale",
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
        headers: { "stripe-signature": "sig_stale" },
      },
      res
    );

    const updatedBusiness = await Business.findById(fixture.business._id).lean();
    const outcomeEvent = await DomainEvent.findOne({
      type: BUSINESS_OBSERVABILITY_EVENT_TYPE,
      "payload.metadata.subscriptionId": "sub_stale",
      shopId: fixture.business._id,
    }).lean();

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("Stale subscription event ignored");
    expect(updatedBusiness.stripeSubscriptionId).toBe("sub_canonical");
    expect(outcomeEvent).toBeTruthy();
    expect(outcomeEvent.payload).toMatchObject({
      signalType: "stripe_webhook_outcome",
      severity: "info",
      reason: "stale_subscription_event",
    });
    expect(outcomeEvent.payload.metadata).toMatchObject({
      stale: true,
      reason: "stale_subscription_event",
    });
  });

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
    await expect(
      Payment.countDocuments({
        business: fixture.business._id,
        paymentScope: "commerce_checkout",
        provider: "stripe",
      })
    ).resolves.toBe(0);
    expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
      expect.any(Buffer),
      "sig_credits",
      "whsec_canonical"
    );
  });

  test("does not add credits twice when a credit purchase checkout is retried", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Credits Retry Owner",
      ownerEmail: "stripe-credits-retry-owner@example.com",
      businessName: "Stripe Credits Retry Shop",
    });

    await CreditProduct.create({
      title: "Retry Credit Pack",
      amount: 49,
      currency: "eur",
      smsCredits: 120,
      emailCredits: 45,
      stripeProductId: "prod_credits_retry",
      stripePriceId: "price_credits_retry",
      isActive: true,
    });

    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_credit_retry",
          metadata: {
            type: "credit_purchase",
            businessId: fixture.business._id.toString(),
            ownerId: fixture.owner._id.toString(),
          },
        },
      },
    });
    mockStripe.checkout.sessions.listLineItems.mockResolvedValue({
      data: [{ price: { id: "price_credits_retry" } }],
    });

    const firstRes = createWebhookResponse();
    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_credits_retry_first" },
      },
      firstRes
    );

    const secondRes = createWebhookResponse();
    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_credits_retry_second" },
      },
      secondRes
    );

    const updatedBusiness = await Business.findById(fixture.business._id).lean();
    const storedPayments = await Payment.find({
      business: fixture.business._id,
      paymentScope: "platform_billing",
      providerReference: "checkout_session:cs_credit_retry",
    }).lean();

    expect(firstRes.statusCode).toBe(200);
    expect(firstRes.payload).toBe("Credits added successfully");
    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.payload).toBe("Credits already processed");
    expect(updatedBusiness.smsCredits).toBe(120);
    expect(updatedBusiness.emailCredits).toBe(45);
    expect(storedPayments).toHaveLength(1);
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

  test("syncs subscription status from Stripe when invoice.paid recovers a past due business", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Paid Recovery Owner",
      ownerEmail: "stripe-paid-recovery-owner@example.com",
      businessName: "Stripe Paid Recovery Shop",
    });

    fixture.business.subscriptionStatus = "past_due";
    fixture.business.stripeSubscriptionId = "sub_recovered";
    fixture.business.stripeCustomerId = "cus_recovered";
    await fixture.business.save();

    mockStripe.webhooks.constructEvent.mockReturnValue(
      createInvoicePaidEvent({
        eventId: "evt_invoice_paid_recovered",
        invoiceId: "in_paid_recovered",
        customerId: "cus_recovered",
        subscriptionId: "sub_recovered",
        businessId: fixture.business._id.toString(),
        amountPaid: 4900,
      })
    );
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_recovered",
      status: "active",
      customer: "cus_recovered",
      metadata: {
        businessId: fixture.business._id.toString(),
      },
    });

    const res = createWebhookResponse();
    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_invoice_paid_recovered" },
      },
      res
    );

    const updatedBusiness = await Business.findById(fixture.business._id).lean();

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("Invoice payment recorded");
    expect(updatedBusiness.subscriptionStatus).toBe("active");
  });

  test("resolves invoice.paid by known subscription id when business metadata is missing", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Invoice Subscription Resolve Owner",
      ownerEmail: "stripe-invoice-subscription-resolve-owner@example.com",
      businessName: "Stripe Invoice Subscription Resolve Shop",
    });

    fixture.business.subscriptionStatus = "past_due";
    fixture.business.stripeSubscriptionId = "sub_invoice_resolve";
    fixture.business.stripeCustomerId = "cus_invoice_resolve";
    await fixture.business.save();

    mockStripe.webhooks.constructEvent.mockReturnValue(
      createInvoicePaidEvent({
        eventId: "evt_invoice_paid_subscription_resolve",
        invoiceId: "in_paid_subscription_resolve",
        customerId: "cus_invoice_resolve",
        subscriptionId: "sub_invoice_resolve",
        amountPaid: 3900,
      })
    );
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_invoice_resolve",
      status: "active",
      customer: "cus_invoice_resolve",
      metadata: {},
    });

    const res = createWebhookResponse();
    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_invoice_subscription_resolve" },
      },
      res
    );

    const storedPayment = await Payment.findOne({
      business: fixture.business._id,
      paymentScope: "platform_billing",
      providerReference: "invoice:in_paid_subscription_resolve",
    }).lean();
    const updatedBusiness = await Business.findById(fixture.business._id).lean();

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("Invoice payment recorded");
    expect(storedPayment).not.toBeNull();
    expect(storedPayment.providerSubscriptionId).toBe("sub_invoice_resolve");
    expect(updatedBusiness.subscriptionStatus).toBe("active");
  });

  test("does not create platform billing payment when invoice business cannot be resolved", async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(
      createInvoicePaidEvent({
        eventId: "evt_invoice_paid_unresolved",
        invoiceId: "in_paid_unresolved",
        customerId: "cus_unknown",
        subscriptionId: "sub_unknown",
        amountPaid: 3900,
      })
    );

    const { res, outcome } = await handleWebhookAndCaptureOutcome(
      "sig_invoice_unresolved"
    );

    const storedPayment = await Payment.findOne({
      paymentScope: "platform_billing",
      providerReference: "invoice:in_paid_unresolved",
    }).lean();

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("Stripe billing business not resolved, skipping");
    expect(storedPayment).toBeNull();
    expect(outcome).toMatchObject({
      signalType: "stripe_webhook_outcome",
      severity: "warning",
      reason: "business_not_resolved",
    });
    expect(outcome.metadata).toMatchObject({
      businessResolution: "not_resolved",
      reason: "business_not_resolved",
    });
  });

  test("does not fallback to subscription id when invoice metadata points to a missing business", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Missing Business Owner",
      ownerEmail: "stripe-missing-business-owner@example.com",
      businessName: "Stripe Missing Business Shop",
    });

    fixture.business.subscriptionStatus = "past_due";
    fixture.business.stripeSubscriptionId = "sub_missing_business";
    fixture.business.stripeCustomerId = "cus_missing_business";
    await fixture.business.save();

    mockStripe.webhooks.constructEvent.mockReturnValue(
      createInvoicePaidEvent({
        eventId: "evt_invoice_paid_missing_business",
        invoiceId: "in_paid_missing_business",
        customerId: "cus_missing_business",
        subscriptionId: "sub_missing_business",
        businessId: "507f1f77bcf86cd799439011",
        amountPaid: 3900,
      })
    );

    const { res, outcome } = await handleWebhookAndCaptureOutcome(
      "sig_invoice_missing_business"
    );

    const storedPayment = await Payment.findOne({
      business: fixture.business._id,
      paymentScope: "platform_billing",
      providerReference: "invoice:in_paid_missing_business",
    }).lean();
    const updatedBusiness = await Business.findById(fixture.business._id).lean();

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("Stripe billing business not resolved, skipping");
    expect(storedPayment).toBeNull();
    expect(updatedBusiness.subscriptionStatus).toBe("past_due");
    expect(outcome).toMatchObject({
      signalType: "stripe_webhook_outcome",
      severity: "warning",
      reason: "business_not_found",
    });
    expect(outcome.metadata).toMatchObject({
      businessResolution: "metadata_business_id_not_found",
      reason: "business_not_found",
    });
  });

  test("records invoice.payment_failed as failed platform billing and syncs negative subscription status", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Failed Invoice Owner",
      ownerEmail: "stripe-failed-owner@example.com",
      businessName: "Stripe Failed Invoice Shop",
    });

    fixture.business.subscriptionStatus = "active";
    fixture.business.stripeSubscriptionId = "sub_failed_invoice";
    fixture.business.stripeCustomerId = "cus_failed_invoice";
    await fixture.business.save();

    mockStripe.webhooks.constructEvent.mockReturnValue(
      createInvoicePaymentFailedEvent({
        eventId: "evt_invoice_failed_once",
        invoiceId: "in_failed_once",
        customerId: "cus_failed_invoice",
        subscriptionId: "sub_failed_invoice",
        businessId: fixture.business._id.toString(),
        amountDue: 4900,
        currency: "eur",
        status: "open",
      })
    );
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_failed_invoice",
      status: "past_due",
      customer: "cus_failed_invoice",
      metadata: {
        businessId: fixture.business._id.toString(),
      },
    });

    const res = createWebhookResponse();
    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_invoice_failed" },
      },
      res
    );

    const storedPayment = await Payment.findOne({
      business: fixture.business._id,
      paymentScope: "platform_billing",
      providerReference: "invoice:in_failed_once",
    }).lean();
    const updatedBusiness = await Business.findById(fixture.business._id).lean();

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("Invoice payment failure recorded");
    expect(storedPayment).not.toBeNull();
    expect(storedPayment.status).toBe("failed");
    expect(storedPayment.amount).toBe(49);
    expect(storedPayment.failureReason).toBe("open");
    expect(updatedBusiness.subscriptionStatus).toBe("past_due");
  });

  test("records invoice.voided as voided platform billing without degrading a captured invoice", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe Voided Invoice Owner",
      ownerEmail: "stripe-voided-owner@example.com",
      businessName: "Stripe Voided Invoice Shop",
    });

    mockStripe.webhooks.constructEvent
      .mockReturnValueOnce(
        createInvoicePaidEvent({
          eventId: "evt_invoice_paid_before_void",
          invoiceId: "in_paid_then_voided",
          customerId: "cus_voided_invoice",
          subscriptionId: "sub_voided_invoice",
          businessId: fixture.business._id.toString(),
          amountPaid: 3300,
          currency: "eur",
          paidAt: 1776556800,
        })
      )
      .mockReturnValueOnce(
        createInvoiceVoidedEvent({
          eventId: "evt_invoice_voided_after_paid",
          invoiceId: "in_paid_then_voided",
          customerId: "cus_voided_invoice",
          subscriptionId: "sub_voided_invoice",
          businessId: fixture.business._id.toString(),
          amountDue: 3300,
          currency: "eur",
        })
      );

    const paidRes = createWebhookResponse();
    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_invoice_paid_before_void" },
      },
      paidRes
    );

    const voidedRes = createWebhookResponse();
    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_invoice_voided_after_paid" },
      },
      voidedRes
    );

    const storedPayment = await Payment.findOne({
      business: fixture.business._id,
      paymentScope: "platform_billing",
      providerReference: "invoice:in_paid_then_voided",
    }).lean();

    expect(paidRes.statusCode).toBe(200);
    expect(voidedRes.statusCode).toBe(200);
    expect(storedPayment).not.toBeNull();
    expect(storedPayment.status).toBe("captured");
    expect(storedPayment.amount).toBe(33);
  });

  test("creates a voided platform billing payment when invoice.voided arrives first", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Stripe First Voided Invoice Owner",
      ownerEmail: "stripe-first-voided-owner@example.com",
      businessName: "Stripe First Voided Invoice Shop",
    });

    mockStripe.webhooks.constructEvent.mockReturnValue(
      createInvoiceVoidedEvent({
        eventId: "evt_invoice_voided_first",
        invoiceId: "in_voided_first",
        customerId: "cus_voided_first",
        subscriptionId: "sub_voided_first",
        businessId: fixture.business._id.toString(),
        amountDue: 2700,
        currency: "eur",
        status: "void",
      })
    );

    const res = createWebhookResponse();
    await handleStripeWebhook(
      {
        rawBody: Buffer.from("{}"),
        headers: { "stripe-signature": "sig_invoice_voided_first" },
      },
      res
    );

    const storedPayment = await Payment.findOne({
      business: fixture.business._id,
      paymentScope: "platform_billing",
      providerReference: "invoice:in_voided_first",
    }).lean();

    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe("Invoice void recorded");
    expect(storedPayment).not.toBeNull();
    expect(storedPayment.status).toBe("voided");
    expect(storedPayment.amount).toBe(27);
    expect(storedPayment.voidReason).toBe("void");
  });
});
