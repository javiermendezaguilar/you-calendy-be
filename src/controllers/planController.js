const Plan = require("../models/plan");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const {
  normalizeFeatureKeys,
  normalizePlanLimits,
} = require("../services/billing/subscriptionPlanService");

/**
 * @desc Get all active plans
 * @route GET /api/plans
 * @access Public
 */
const getPlans = async (req, res) => {
  // #swagger.tags = ['Plans']
  /* #swagger.description = 'Get all active plans'
     #swagger.responses[200] = {
        description: 'List of active plans',
        schema: { $ref: '#/definitions/PlanList' }
     }
  */
  try {
    const plans = await Plan.find({ isActive: true })
      .sort({ createdAt: -1 })
      .select("-__v");

    return SuccessHandler(plans, 200, res);
  } catch (error) {
    console.error("Get plans error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get a single plan by ID
 * @route GET /api/plans/:id
 * @access Public
 */
const getPlanById = async (req, res) => {
  // #swagger.tags = ['Plans']
  /* #swagger.description = 'Get a single plan by ID'
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Plan ID',
        required: true,
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Plan details',
        schema: { $ref: '#/definitions/Plan' }
     }
     #swagger.responses[404] = {
        description: 'Plan not found'
     }
  */
  try {
    const plan = await Plan.findById(req.params.id).select("-__v");

    if (!plan) {
      return ErrorHandler("Plan not found", 404, req, res);
    }

    return SuccessHandler(plan, 200, res);
  } catch (error) {
    console.error("Get plan by ID error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Create a new plan with Stripe integration
 * @route POST /api/plans
 * @access Private (Admin only)
 */
const createPlan = async (req, res) => {
  // #swagger.tags = ['Plans']
  /* #swagger.description = 'Create a new plan with Stripe integration'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Plan information',
        required: true,
        schema: {
          title: 'Premium Plan',
          description: 'Premium features for businesses',
          amount: 29.99,
          features: ['Unlimited appointments', 'Advanced analytics', 'Priority support'],
          currency: 'usd',
          billingInterval: 'month'
        }
     }
     #swagger.responses[201] = {
        description: 'Plan created successfully',
        schema: { $ref: '#/definitions/Plan' }
     }
     #swagger.responses[400] = {
        description: 'Validation error'
     }
  */
  try {
    const {
      title,
      description,
      amount,
      features,
      featureKeys,
      limits,
      currency,
      billingInterval,
      // sortOrder,
    } = req.body;

    // Validate required fields
    if (
      !title ||
      !description ||
      !amount ||
      !features ||
      !Array.isArray(features)
    ) {
      return ErrorHandler(
        "Title, description, amount, and features array are required",
        400,
        req,
        res
      );
    }

    if (amount <= 0) {
      return ErrorHandler("Amount must be greater than 0", 400, req, res);
    }

    if (features.length === 0) {
      return ErrorHandler("At least one feature is required", 400, req, res);
    }

    // Create Stripe product
    const stripeProduct = await stripe.products.create({
      name: title,
      description: description,
      metadata: {
        type: "plan",
        features: JSON.stringify(features),
        featureKeys: JSON.stringify(normalizeFeatureKeys(featureKeys)),
        limits: JSON.stringify(normalizePlanLimits(limits)),
      },
    });

    // Create Stripe price
    const stripePrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: Math.round(amount * 100), // Convert to cents
      currency: currency || "usd",
      recurring: {
        interval: billingInterval || "month",
      },
      metadata: {
        type: "plan_price",
      },
    });

    // Create plan in database
    const newPlan = await Plan.create({
      title,
      description,
      amount,
      features,
      featureKeys: normalizeFeatureKeys(featureKeys),
      limits: normalizePlanLimits(limits),
      stripeProductId: stripeProduct.id,
      stripePriceId: stripePrice.id,
      currency: currency || "usd",
      billingInterval: billingInterval || "month",
      // sortOrder: sortOrder || 0,
      isActive: true,
    });

    return SuccessHandler(newPlan, 201, res);
  } catch (error) {
    console.error("Create plan error:", error.message);

    // If Stripe operation failed, clean up any created resources
    if (error.type === "StripeError") {
      return ErrorHandler(`Stripe error: ${error.message}`, 400, req, res);
    }

    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update a plan
 * @route PUT /api/plans/:id
 * @access Private (Admin only)
 */
const updatePlan = async (req, res) => {
  // #swagger.tags = ['Plans']
  /* #swagger.description = 'Update a plan'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Plan ID',
        required: true,
        type: 'string'
     }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Updated plan information',
        required: true,
        schema: {
          title: 'Updated Premium Plan',
          description: 'Updated description',
          amount: 39.99,
          features: ['Updated feature 1', 'Updated feature 2'],
          isActive: true
        }
     }
     #swagger.responses[200] = {
        description: 'Plan updated successfully',
        schema: { $ref: '#/definitions/Plan' }
     }
     #swagger.responses[404] = {
        description: 'Plan not found'
     }
  */
  try {
    const {
      title,
      description,
      amount,
      features,
      featureKeys,
      limits,
      isActive,
    } = req.body;
    const planId = req.params.id;

    // Find the plan
    const plan = await Plan.findById(planId);
    if (!plan) {
      return ErrorHandler("Plan not found", 404, req, res);
    }

    // Update Stripe product if title or description changed
    if (title || description) {
      await stripe.products.update(plan.stripeProductId, {
        name: title || plan.title,
        description: description || plan.description,
        metadata: {
          type: "plan",
          features: JSON.stringify(features || plan.features),
          featureKeys: JSON.stringify(
            normalizeFeatureKeys(featureKeys || plan.featureKeys)
          ),
          limits: JSON.stringify(normalizePlanLimits(limits || plan.limits)),
        },
      });
    }

    // Update Stripe price if amount changed
    if (amount && amount !== plan.amount) {
      // Create new price (Stripe doesn't allow updating existing prices)
      const newStripePrice = await stripe.prices.create({
        product: plan.stripeProductId,
        unit_amount: Math.round(amount * 100),
        currency: plan.currency,
        recurring: {
          interval: plan.billingInterval,
        },
        metadata: {
          type: "plan_price",
        },
      });

      // Archive old price
      await stripe.prices.update(plan.stripePriceId, { active: false });

      // Update plan with new price ID
      plan.stripePriceId = newStripePrice.id;
    }

    if (title) plan.title = title;
    if (description) plan.description = description;
    if (amount !== undefined) plan.amount = amount;
    if (features !== undefined) plan.features = features;
    if (featureKeys !== undefined) {
      plan.featureKeys = normalizeFeatureKeys(featureKeys);
    }
    if (limits !== undefined) plan.limits = normalizePlanLimits(limits);
    if (typeof isActive === "boolean") plan.isActive = isActive;
    // if (typeof sortOrder === "number") plan.sortOrder = sortOrder;

    await plan.save();
    const updatedPlan = await Plan.findById(planId).select("-__v");

    return SuccessHandler(updatedPlan, 200, res);
  } catch (error) {
    console.error("Update plan error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a plan
 * @route DELETE /api/plans/:id
 * @access Private (Admin only)
 */
const deletePlan = async (req, res) => {
  // #swagger.tags = ['Plans']
  /* #swagger.description = 'Delete a plan'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Plan ID',
        required: true,
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Plan deleted successfully'
     }
     #swagger.responses[404] = {
        description: 'Plan not found'
     }
  */
  try {
    const planId = req.params.id;

    // Find the plan
    const plan = await Plan.findById(planId);
    if (!plan) {
      return ErrorHandler("Plan not found", 404, req, res);
    }

    // Archive Stripe price (don't delete to preserve subscription history)
    await stripe.prices.update(plan.stripePriceId, { active: false });

    // Archive Stripe product (don't delete to preserve subscription history)
    await stripe.products.update(plan.stripeProductId, { active: false });

    // Delete plan from database
    await Plan.findByIdAndDelete(planId);

    return SuccessHandler({ message: "Plan deleted successfully" }, 200, res);
  } catch (error) {
    console.error("Delete plan error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all plans (including inactive) - Admin only
 * @route GET /api/plans/admin/all
 * @access Private (Admin only)
 */
const getAllPlans = async (req, res) => {
  // #swagger.tags = ['Plans']
  /* #swagger.description = 'Get all plans including inactive ones (Admin only)'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'List of all plans',
        schema: { $ref: '#/definitions/PlanList' }
     }
  */
  try {
    const plans = await Plan.find();
    //   .sort({ sortOrder: 1, createdAt: -1 })
    //   .select("-__v");

    return SuccessHandler(plans, 200, res);
  } catch (error) {
    console.error("Get all plans error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  getPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  getAllPlans,
};
