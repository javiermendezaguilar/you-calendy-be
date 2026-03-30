const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const CreditProduct = require("../models/creditProduct");
const Business = require("../models/User/business");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const {
  sendNotificationToAdmins,
} = require("../utils/adminNotificationHelper");

// Admin: create a credits product (Stripe product + price)
const createCreditProduct = async (req, res) => {
  try {
    const { title, description, amount, currency, smsCredits, emailCredits } =
      req.body;
    if (!title || !amount) {
      return ErrorHandler("title and amount are required", 400, req, res);
    }
    const product = await stripe.products.create({
      name: title,
      description: description || "",
      metadata: {
        type: "credit_bundle",
        smsCredits: String(smsCredits || 0),
        emailCredits: String(emailCredits || 0),
      },
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(Number(amount) * 100),
      currency: currency || "usd",
      metadata: { type: "credit_bundle_price" },
    });
    const doc = await CreditProduct.create({
      title,
      description: description || "",
      amount: Number(amount),
      currency: currency || "usd",
      smsCredits: Number(smsCredits) || 0,
      emailCredits: Number(emailCredits) || 0,
      stripeProductId: product.id,
      stripePriceId: price.id,
      isActive: true,
    });
    return SuccessHandler(doc, 201, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

// Public: list active credit products
const listCreditProducts = async (req, res) => {
  try {
    const products = await CreditProduct.find({ isActive: true }).sort({
      createdAt: -1,
    });
    return SuccessHandler(products, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

// Barber: create checkout session for a credit product
const createCheckoutSession = async (req, res) => {
  try {
    const { priceId } = req.body;
    if (!priceId) return ErrorHandler("priceId is required", 400, req, res);

    const business = await Business.findOne({ owner: req.user.id });
    if (!business) return ErrorHandler("Business not found", 404, req, res);

    // Verify the credit product exists and is active
    const creditProduct = await CreditProduct.findOne({
      stripePriceId: priceId,
      isActive: true,
    });
    if (!creditProduct) {
      return ErrorHandler(
        "Credit product not found or inactive",
        404,
        req,
        res
      );
    }

    console.log(
      `Creating checkout session for business: ${business._id}, user: ${req.user.id}, price: ${priceId}`
    );

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/billing/credits?success=1`,
      cancel_url: `${process.env.FRONTEND_URL}/billing/credits?canceled=1`,
      metadata: {
        businessId: String(business._id),
        ownerId: String(req.user.id),
        type: "credit_purchase",
      },
    });

    console.log(`Checkout session created: ${session.id}`);

    // Send notification to admins
    await sendNotificationToAdmins(
      "Credit Purchase Checkout Session Created",
      `Business "${
        business.name || business.businessName
      }" has initiated a credit purchase checkout session (ID: ${
        session.id
      }) for ${creditProduct.title}`,
      "admin",
      {
        businessId: business._id,
        businessName: business.name || business.businessName,
        sessionId: session.id,
        creditProductId: creditProduct._id,
        creditProductTitle: creditProduct.title,
        ownerId: req.user.id,
      }
    );

    return SuccessHandler({ id: session.id, url: session.url }, 200, res);
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

// Admin: activate/deactivate a credit product
const updateCreditProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      amount,
      currency,
      smsCredits,
      emailCredits,
      isActive,
    } = req.body;
    const doc = await CreditProduct.findById(id);
    if (!doc) return ErrorHandler("Credit product not found", 404, req, res);
    if (title || description) {
      await stripe.products.update(doc.stripeProductId, {
        name: title || doc.title,
        description: description ?? doc.description,
        metadata: {
          type: "credit_bundle",
          smsCredits: String(smsCredits ?? doc.smsCredits),
          emailCredits: String(emailCredits ?? doc.emailCredits),
        },
      });
    }
    if (amount && amount !== doc.amount) {
      const newPrice = await stripe.prices.create({
        product: doc.stripeProductId,
        unit_amount: Math.round(Number(amount) * 100),
        currency: currency || doc.currency,
        metadata: { type: "credit_bundle_price" },
      });
      await stripe.prices.update(doc.stripePriceId, { active: false });
      doc.stripePriceId = newPrice.id;
    }
    if (typeof isActive === "boolean") {
      doc.isActive = isActive;
      await stripe.products.update(doc.stripeProductId, { active: isActive });
    }
    if (title) doc.title = title;
    if (description !== undefined) doc.description = description;
    if (amount) doc.amount = Number(amount);
    if (currency) doc.currency = currency;
    if (smsCredits !== undefined) doc.smsCredits = Number(smsCredits);
    if (emailCredits !== undefined) doc.emailCredits = Number(emailCredits);
    await doc.save();
    return SuccessHandler(doc, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

// Admin: delete a credit product
const deleteCreditProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await CreditProduct.findById(id);
    if (!doc) return ErrorHandler("Credit product not found", 404, req, res);

    // Deactivate the Stripe product and price
    await stripe.products.update(doc.stripeProductId, { active: false });
    await stripe.prices.update(doc.stripePriceId, { active: false });

    // Delete from database
    await CreditProduct.findByIdAndDelete(id);

    return SuccessHandler(
      { message: "Credit product deleted successfully" },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

// Barber: get current credits for their business
const getBusinessCredits = async (req, res) => {
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) return ErrorHandler("Business not found", 404, req, res);

    return SuccessHandler(
      {
        smsCredits: business.smsCredits || 0,
        emailCredits: business.emailCredits || 0,
        businessId: business._id,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  createCreditProduct,
  listCreditProducts,
  createCheckoutSession,
  updateCreditProduct,
  deleteCreditProduct,
  getBusinessCredits,
};
