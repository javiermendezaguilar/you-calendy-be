const request = require("supertest");
const Appointment = require("../models/appointment");
const Client = require("../models/client");
const DomainEvent = require("../models/domainEvent");
const Payment = require("../models/payment");
const PolicyCharge = require("../models/policyCharge");
const {
  createCommerceFixture,
} = require("./helpers/commerceFixture");
const {
  mockStripe,
  registerStripeBillingTestHooks,
} = require("./helpers/stripeBillingTestHelper");

jest.mock("../services/billing/stripeClient", () => mockStripe);

const app = require("../app");
const {
  processStripeWebhookEvent,
} = require("../services/billing/stripeWebhookService");

registerStripeBillingTestHooks();

const noDiscountState = () => ({
  applied: false,
  discountAmount: 0,
  discountPercentage: 0,
  originalPrice: 0,
});

const createPolicyFixture = (overrides = {}) =>
  createCommerceFixture({
    ownerName: "Policy Charge Owner",
    ownerEmail: overrides.ownerEmail || "policy-charge-owner@example.com",
    businessName: "Policy Charge Shop",
    appointmentStatus: overrides.appointmentStatus || "Confirmed",
    bookingStatus: overrides.bookingStatus || "confirmed",
    visitStatus: overrides.visitStatus || "not_started",
    paymentStatus: "Pending",
    servicePrice: overrides.servicePrice ?? 50,
    appointmentPrice: overrides.appointmentPrice ?? 50,
    bookingBuffer: 0,
    penaltySettings: {
      noShowPenalty: true,
      noShowPenaltyAmount: overrides.noShowPenaltyAmount ?? 25,
    },
    policySettings: {
      cancellationWindowMinutes: 180,
      noShowGracePeriodMinutes: 0,
      lateCancelFeeEnabled: true,
      lateCancelFeeAmount: overrides.lateCancelFeeAmount ?? 12,
      depositRequired: overrides.depositRequired ?? true,
      depositAmount: overrides.depositAmount ?? 20,
      blockOnNoShow: true,
      blockScope: "business",
    },
    promotion: noDiscountState(),
    flashSale: noDiscountState(),
  });

const createPolicyCharge = (appointmentId, token, idempotencyKey, payload) =>
  request(app)
    .post(`/appointments/${appointmentId}/policy-charges`)
    .set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", idempotencyKey)
    .send(payload);

const markPolicyOutcome = (appointmentId, outcome) =>
  Appointment.findByIdAndUpdate(appointmentId, {
    status: outcome.type === "no_show" ? "No-Show" : "Canceled",
    bookingStatus: outcome.type === "no_show" ? "confirmed" : "cancelled",
    visitStatus: outcome.type === "no_show" ? "no_show" : "cancelled",
    policyOutcome: {
      type: outcome.type,
      feeApplied: true,
      feeAmount: outcome.amount,
    },
    penalty: {
      applied: true,
      amount: outcome.amount,
      type: outcome.type,
      source: "policy_snapshot",
    },
  });

const configureStripeIntent = ({
  id = "pi_policy_charge",
  clientSecret = "pi_policy_charge_secret",
  status = "requires_payment_method",
} = {}) => {
  mockStripe.customers.create.mockResolvedValue({
    id: "cus_policy_charge",
  });
  mockStripe.paymentIntents.create.mockResolvedValue({
    id,
    client_secret: clientSecret,
    status,
  });
};

describe("Policy charges v1", () => {
  beforeEach(() => {
    configureStripeIntent();
  });

  test("creates a deposit payment intent from frozen policy snapshot and prepares card-on-file", async () => {
    const fixture = await createPolicyFixture({
      depositAmount: 20,
    });

    const res = await createPolicyCharge(
      fixture.appointment._id,
      fixture.token,
      "deposit-intent-1",
      {
        type: "deposit",
        saveCardOnFile: true,
      }
    );

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe("deposit");
    expect(res.body.data.amount).toBe(20);
    expect(res.body.data.currency).toBe("EUR");
    expect(res.body.data.status).toBe("requires_payment_method");
    expect(res.body.data.providerReference).toBe("pi_policy_charge");
    expect(res.body.data.clientSecret).toBe("pi_policy_charge_secret");

    expect(mockStripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [payload, options] = mockStripe.paymentIntents.create.mock.calls[0];
    expect(payload.amount).toBe(2000);
    expect(payload.currency).toBe("eur");
    expect(payload.customer).toBe("cus_policy_charge");
    expect(payload.setup_future_usage).toBe("off_session");
    expect(payload.metadata.policyChargeType).toBe("deposit");
    expect(payload.metadata.appointmentId).toBe(String(fixture.appointment._id));
    expect(options.idempotencyKey).toContain("deposit-intent-1");

    const client = await Client.findById(fixture.client._id).lean();
    expect(client.stripeCustomerId).toBe("cus_policy_charge");
    expect(client.cardOnFile.status).toBe("pending");
  });

  test("rejects caller-provided amount that does not match frozen deposit amount", async () => {
    const fixture = await createPolicyFixture({
      depositAmount: 20,
    });

    const res = await createPolicyCharge(
      fixture.appointment._id,
      fixture.token,
      "deposit-mismatch",
      {
        type: "deposit",
        amount: 21,
      }
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/must match/i);
    expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  test("allows appointment client to start a deposit but not penalty fees", async () => {
    const fixture = await createPolicyFixture({
      depositAmount: 20,
    });
    const clientToken = fixture.client.getJWTToken();

    const deposit = await createPolicyCharge(
      fixture.appointment._id,
      clientToken,
      "client-deposit",
      { type: "deposit" }
    );

    expect(deposit.status).toBe(201);
    expect(deposit.body.data.type).toBe("deposit");

    await markPolicyOutcome(fixture.appointment._id, {
      type: "no_show",
      amount: 25,
    });
    const penalty = await createPolicyCharge(
      fixture.appointment._id,
      clientToken,
      "client-no-show-fee",
      { type: "no_show_fee" }
    );

    expect(penalty.status).toBe(403);
    expect(penalty.body.message).toMatch(/Not authorized/i);
    expect(mockStripe.paymentIntents.create).toHaveBeenCalledTimes(1);
  });

  test("returns the same charge on idempotent retry and rejects key reuse for another charge", async () => {
    const fixture = await createPolicyFixture({
      depositAmount: 20,
    });

    const first = await createPolicyCharge(
      fixture.appointment._id,
      fixture.token,
      "same-key",
      { type: "deposit" }
    );
    const retry = await createPolicyCharge(
      fixture.appointment._id,
      fixture.token,
      "same-key",
      { type: "deposit" }
    );

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.data._id).toBe(first.body.data._id);
    expect(mockStripe.paymentIntents.create).toHaveBeenCalledTimes(1);

    await markPolicyOutcome(fixture.appointment._id, {
      type: "no_show",
      amount: 25,
    });

    const reuse = await createPolicyCharge(
      fixture.appointment._id,
      fixture.token,
      "same-key",
      { type: "no_show_fee" }
    );

    expect(reuse.status).toBe(409);
    expect(reuse.body.message).toMatch(/Idempotency key/i);
  });

  test("creates no-show and late-cancel fee intents only from existing policy outcomes", async () => {
    const noShowFixture = await createPolicyFixture({
      ownerEmail: "policy-charge-noshow@example.com",
      depositRequired: false,
      noShowPenaltyAmount: 25,
    });
    await markPolicyOutcome(noShowFixture.appointment._id, {
      type: "no_show",
      amount: 25,
    });

    const noShow = await createPolicyCharge(
      noShowFixture.appointment._id,
      noShowFixture.token,
      "no-show-fee-1",
      { type: "no_show_fee" }
    );

    expect(noShow.status).toBe(201);
    expect(noShow.body.data.amount).toBe(25);
    expect(noShow.body.data.type).toBe("no_show_fee");

    const lateFixture = await createPolicyFixture({
      ownerEmail: "policy-charge-late@example.com",
      depositRequired: false,
      lateCancelFeeAmount: 12,
    });
    await markPolicyOutcome(lateFixture.appointment._id, {
      type: "late_cancel",
      amount: 12,
    });

    const late = await createPolicyCharge(
      lateFixture.appointment._id,
      lateFixture.token,
      "late-fee-1",
      { type: "late_cancel_fee" }
    );

    expect(late.status).toBe(201);
    expect(late.body.data.amount).toBe(12);
    expect(late.body.data.type).toBe("late_cancel_fee");
  });

  test("records succeeded Stripe policy charge as commerce_policy payment exactly once", async () => {
    const fixture = await createPolicyFixture({
      depositAmount: 20,
    });
    const chargeRes = await createPolicyCharge(
      fixture.appointment._id,
      fixture.token,
      "deposit-success",
      {
        type: "deposit",
        saveCardOnFile: true,
      }
    );

    const chargeId = chargeRes.body.data._id;
    const event = {
      id: "evt_policy_success",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_policy_charge",
          status: "succeeded",
          amount: 2000,
          amount_received: 2000,
          currency: "eur",
          customer: "cus_policy_charge",
          payment_method: "pm_saved_card",
          metadata: {
            policyChargeId: chargeId,
            businessId: String(fixture.business._id),
            appointmentId: String(fixture.appointment._id),
            policyChargeType: "deposit",
            saveCardOnFile: "true",
          },
        },
      },
    };

    const first = await processStripeWebhookEvent(event);
    const retry = await processStripeWebhookEvent(event);

    expect(first.message).toBe("Policy charge payment recorded");
    expect(retry.message).toBe("Policy charge payment recorded");

    const storedCharge = await PolicyCharge.findById(chargeId).lean();
    expect(storedCharge.status).toBe("succeeded");
    expect(storedCharge.paidAt).toBeTruthy();

    const payments = await Payment.find({
      paymentScope: "commerce_policy",
      providerReference: "payment_intent:pi_policy_charge",
    }).lean();
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(20);
    expect(payments[0].appointment.toString()).toBe(String(fixture.appointment._id));

    const client = await Client.findById(fixture.client._id).lean();
    expect(client.cardOnFile.status).toBe("usable");
    expect(client.cardOnFile.paymentMethodId).toBe("pm_saved_card");

    const capturedEvents = await DomainEvent.find({
      type: "policy_charge_captured",
      correlationId: chargeId,
    }).lean();
    expect(capturedEvents).toHaveLength(1);
  });

  test("marks failed Stripe policy charge without creating a payment", async () => {
    const fixture = await createPolicyFixture({
      depositAmount: 20,
    });
    const chargeRes = await createPolicyCharge(
      fixture.appointment._id,
      fixture.token,
      "deposit-failed",
      { type: "deposit" }
    );

    const event = {
      id: "evt_policy_failed",
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: "pi_policy_charge",
          status: "requires_payment_method",
          amount: 2000,
          currency: "eur",
          customer: "cus_policy_charge",
          last_payment_error: {
            message: "Card declined",
          },
          metadata: {
            policyChargeId: chargeRes.body.data._id,
            businessId: String(fixture.business._id),
            appointmentId: String(fixture.appointment._id),
            policyChargeType: "deposit",
          },
        },
      },
    };

    const result = await processStripeWebhookEvent(event);

    expect(result.message).toBe("Policy charge payment failure recorded");
    const storedCharge = await PolicyCharge.findById(chargeRes.body.data._id).lean();
    expect(storedCharge.status).toBe("failed");
    expect(storedCharge.failureReason).toBe("Card declined");

    const payments = await Payment.find({
      paymentScope: "commerce_policy",
    }).lean();
    expect(payments).toHaveLength(0);
  });
});
