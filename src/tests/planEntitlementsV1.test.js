const request = require("supertest");
const moment = require("moment");
const Business = require("../models/User/business");
const Plan = require("../models/plan");
const { createCommerceFixture } = require("./helpers/commerceFixture");
const {
  mockStripe,
  registerStripeBillingTestHooks,
} = require("./helpers/stripeBillingTestHelper");
const {
  PLATFORM_BILLING_SCOPE,
} = require("../services/payment/reportingScope");

jest.mock("../services/billing/stripeClient", () => mockStripe);

const app = require("../app");

registerStripeBillingTestHooks();

const createActivePlan = async (overrides = {}) =>
  Plan.create({
    title: overrides.title || "Growth",
    description: overrides.description || "Growth plan",
    amount: overrides.amount ?? 49,
    features: overrides.features || ["Booking", "CRM", "Campaigns"],
    featureKeys: overrides.featureKeys || [
      "booking",
      "client_crm",
      "campaigns",
    ],
    limits: {
      maxStaff: overrides.maxStaff ?? 5,
      maxLocations: overrides.maxLocations ?? 1,
      monthlyCampaignRecipients: overrides.monthlyCampaignRecipients ?? 1000,
      smsCreditsIncluded: overrides.smsCreditsIncluded ?? 0,
      emailCreditsIncluded: overrides.emailCreditsIncluded ?? 0,
    },
    stripeProductId: overrides.stripeProductId || "prod_growth",
    stripePriceId: overrides.stripePriceId || "price_growth",
    currency: overrides.currency || "eur",
    billingInterval: overrides.billingInterval || "month",
    isActive: overrides.isActive ?? true,
  });

describe("plan entitlements v1", () => {
  beforeEach(async () => {
    await Plan.deleteMany({});
  });

  test("returns current product access, feature keys and limits for a subscribed business", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Entitlements Owner",
      ownerEmail: "entitlements-owner@example.com",
      businessName: "Entitlements Shop",
    });
    const plan = await createActivePlan();

    fixture.business.subscriptionStatus = "active";
    fixture.business.subscriptionPlan = {
      planId: plan._id,
      title: plan.title,
      stripePriceId: plan.stripePriceId,
      stripeProductId: plan.stripeProductId,
      billingInterval: plan.billingInterval,
      currency: plan.currency,
      amount: plan.amount,
      featureKeys: plan.featureKeys,
      limits: plan.limits,
      source: "plan_snapshot",
    };
    await fixture.business.save();

    const res = await request(app)
      .get("/business/entitlements")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.billingScope).toEqual(PLATFORM_BILLING_SCOPE);
    expect(res.body.data.subscription.status).toBe("active");
    expect(res.body.data.subscription.effectiveStatus).toBe("active");
    expect(res.body.data.access.canUseProduct).toBe(true);
    expect(res.body.data.access.reason).toBe("subscription_active");
    expect(res.body.data.plan.source).toBe("plan_snapshot");
    expect(res.body.data.plan.stripePriceId).toBe("price_growth");
    expect(res.body.data.features.booking).toBe(true);
    expect(res.body.data.features.client_crm).toBe(true);
    expect(res.body.data.features.campaigns).toBe(true);
    expect(res.body.data.features.operational_reporting).toBe(false);
    expect(res.body.data.limits.maxStaff).toBe(5);
    expect(res.body.data.limits.monthlyCampaignRecipients).toBe(1000);
  });

  test("keeps active legacy businesses usable when they do not have a plan snapshot", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Legacy Entitlements Owner",
      ownerEmail: "legacy-entitlements-owner@example.com",
      businessName: "Legacy Entitlements Shop",
    });

    fixture.business.subscriptionStatus = "active";
    fixture.business.subscriptionPlan = undefined;
    await fixture.business.save();

    const res = await request(app)
      .get("/business/entitlements")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.access.canUseProduct).toBe(true);
    expect(res.body.data.plan.source).toBe("legacy_full_access");
    expect(res.body.data.features.booking).toBe(true);
    expect(res.body.data.features.operational_reporting).toBe(true);
  });

  test("blocks product access for expired trials without mutating credits or plan data", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Expired Trial Owner",
      ownerEmail: "expired-trial-owner@example.com",
      businessName: "Expired Trial Shop",
    });

    fixture.business.subscriptionStatus = "trialing";
    fixture.business.trialStart = moment().subtract(20, "days").toDate();
    fixture.business.trialEnd = moment().subtract(5, "days").toDate();
    fixture.business.smsCredits = 3;
    fixture.business.emailCredits = 4;
    await fixture.business.save();

    const res = await request(app)
      .get("/business/entitlements")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.subscription.status).toBe("trialing");
    expect(res.body.data.subscription.effectiveStatus).toBe(
      "incomplete_expired"
    );
    expect(res.body.data.access.canUseProduct).toBe(false);
    expect(res.body.data.access.reason).toBe("trial_expired");
    expect(res.body.data.features.booking).toBe(false);

    const updatedBusiness = await Business.findById(fixture.business._id).lean();
    expect(updatedBusiness.smsCredits).toBe(3);
    expect(updatedBusiness.emailCredits).toBe(4);
  });

  test("subscription status response includes entitlements for the frontend contract", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Subscription Entitlements Owner",
      ownerEmail: "subscription-entitlements-owner@example.com",
      businessName: "Subscription Entitlements Shop",
    });

    fixture.business.subscriptionStatus = "active";
    await fixture.business.save();

    const res = await request(app)
      .get("/business/subscription-status")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.entitlements.access.canUseProduct).toBe(true);
    expect(res.body.data.entitlements.plan.source).toBe("legacy_full_access");
  });

  test("rejects subscription creation for price IDs that are not active Groomnest plans", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Invalid Plan Owner",
      ownerEmail: "invalid-plan-owner@example.com",
      businessName: "Invalid Plan Shop",
    });

    fixture.business.trialUsed = true;
    fixture.business.subscriptionStatus = "trialing";
    fixture.business.trialEnd = moment().add(21, "days").toDate();
    await fixture.business.save();

    const res = await request(app)
      .post("/business/create-subscription")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ priceId: "price_not_registered" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/active plan/i);
    expect(mockStripe.subscriptions.create).not.toHaveBeenCalled();
  });

  test("stores a plan snapshot when creating a trial subscription from an active plan", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Create Plan Owner",
      ownerEmail: "create-plan-owner@example.com",
      businessName: "Create Plan Shop",
    });
    const plan = await createActivePlan({
      stripePriceId: "price_create_plan",
      stripeProductId: "prod_create_plan",
      featureKeys: ["booking", "client_crm", "operational_reporting"],
      maxStaff: 8,
    });

    fixture.business.trialUsed = true;
    fixture.business.subscriptionStatus = "trialing";
    fixture.business.trialStart = moment().subtract(1, "day").toDate();
    fixture.business.trialEnd = moment().add(21, "days").toDate();
    await fixture.business.save();

    mockStripe.customers.create.mockResolvedValue({
      id: "cus_create_plan",
    });
    mockStripe.subscriptions.create.mockResolvedValue({
      id: "sub_create_plan",
      status: "trialing",
      customer: "cus_create_plan",
      metadata: {
        businessId: fixture.business._id.toString(),
      },
    });

    const res = await request(app)
      .post("/business/create-subscription")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ priceId: "price_create_plan" });

    expect(res.status).toBe(200);
    expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ price: "price_create_plan" }],
        metadata: expect.objectContaining({
          businessId: fixture.business._id.toString(),
          planPriceId: "price_create_plan",
        }),
      })
    );

    const updatedBusiness = await Business.findById(fixture.business._id).lean();
    expect(updatedBusiness.subscriptionPlan.stripePriceId).toBe(
      "price_create_plan"
    );
    expect(updatedBusiness.subscriptionPlan.planId.toString()).toBe(
      plan._id.toString()
    );
    expect(updatedBusiness.subscriptionPlan.featureKeys).toEqual([
      "booking",
      "client_crm",
      "operational_reporting",
    ]);
    expect(updatedBusiness.subscriptionPlan.limits.maxStaff).toBe(8);
  });
});
