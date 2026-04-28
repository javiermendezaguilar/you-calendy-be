const {
  PAYMENT_SCOPE,
} = require("../services/payment/paymentScope");
const {
  stripePaymentProvider,
} = require("../services/payment/providerAdapters");

describe("Payment provider adapters v1", () => {
  test("normalizes Stripe money and provider references without leaking provider shape", () => {
    expect(stripePaymentProvider.toMinorUnit(12.345)).toBe(1235);
    expect(stripePaymentProvider.fromMinorUnit(1235)).toBe(12.35);
    expect(stripePaymentProvider.normalizeCurrency("eur")).toBe("EUR");
    expect(stripePaymentProvider.toProviderCurrency("EUR")).toBe("eur");
    expect(stripePaymentProvider.references.paymentIntent("pi_123")).toBe(
      "payment_intent:pi_123"
    );
    expect(stripePaymentProvider.references.invoice("in_123")).toBe("invoice:in_123");
    expect(stripePaymentProvider.references.checkoutSession("cs_123")).toBe(
      "checkout_session:cs_123"
    );
  });

  test("classifies policy charge payment intents as commerce_policy only", () => {
    const event = {
      id: "evt_policy_success",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_policy",
          metadata: {
            policyChargeId: "policy_charge_id",
            policyChargeType: "deposit",
          },
        },
      },
    };

    expect(stripePaymentProvider.classifyWebhookEvent(event)).toMatchObject({
      eventType: "payment_intent.succeeded",
      targetScope: PAYMENT_SCOPE.COMMERCE_POLICY,
      providerReference: "payment_intent:pi_policy",
      action: "policy_charge_succeeded",
    });
  });

  test("classifies Stripe billing events as platform_billing and never commerce_checkout", () => {
    const creditPurchase = stripePaymentProvider.classifyWebhookEvent({
      id: "evt_credit",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_credit",
          metadata: {
            type: "credit_purchase",
          },
        },
      },
    });
    const invoicePaid = stripePaymentProvider.classifyWebhookEvent({
      id: "evt_invoice",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_invoice",
        },
      },
    });

    expect(creditPurchase.targetScope).toBe(PAYMENT_SCOPE.PLATFORM_BILLING);
    expect(creditPurchase.providerReference).toBe("checkout_session:cs_credit");
    expect(invoicePaid.targetScope).toBe(PAYMENT_SCOPE.PLATFORM_BILLING);
    expect(invoicePaid.providerReference).toBe("invoice:in_invoice");
    expect(creditPurchase.targetScope).not.toBe(PAYMENT_SCOPE.COMMERCE_CHECKOUT);
    expect(invoicePaid.targetScope).not.toBe(PAYMENT_SCOPE.COMMERCE_CHECKOUT);
  });

  test("leaves generic payment intents unhandled instead of guessing a checkout payment", () => {
    const event = {
      id: "evt_generic",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_generic",
          metadata: {},
        },
      },
    };

    expect(stripePaymentProvider.classifyWebhookEvent(event)).toMatchObject({
      targetScope: null,
      providerReference: "payment_intent:pi_generic",
      reason: "unhandled_payment_intent",
    });
  });
});
