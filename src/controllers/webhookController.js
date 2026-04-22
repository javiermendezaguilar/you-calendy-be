const ErrorHandler = require("../utils/ErrorHandler");
const stripe = require("../services/billing/stripeClient");
const {
  getStripeWebhookSecret,
  processStripeWebhookEvent,
} = require("../services/billing/stripeWebhookService");

const logStripeWebhookOutcome = (result) => {
  if (!result || typeof result !== "object") {
    return;
  }

  const meta = result.meta || {};
  console.log(
    "Stripe webhook outcome:",
    JSON.stringify({
      message: result.message,
      ...meta,
    })
  );
};

// Stripe webhook to fulfill credit purchases and subscription payments
const handleStripeWebhook = async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      const endpointSecret = getStripeWebhookSecret();
      if (!endpointSecret) {
        console.error("Stripe webhook secret is not configured");
        return res.status(400).send("Webhook secret not configured");
      }

      event = stripe.webhooks.constructEvent(
        req.rawBody || req.body,
        sig,
        endpointSecret
      );

      console.log(`Received webhook event: ${event.type}`);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const result = await processStripeWebhookEvent(event);
    logStripeWebhookOutcome(result);
    return res.status(200).send(result?.message || "Unhandled event");
  } catch (error) {
    console.error("Webhook processing error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = { handleStripeWebhook };
