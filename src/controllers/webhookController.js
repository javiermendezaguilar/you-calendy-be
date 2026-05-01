const ErrorHandler = require("../utils/ErrorHandler");
const stripe = require("../services/billing/stripeClient");
const {
  getStripeWebhookSecret,
  processStripeWebhookEvent,
} = require("../services/billing/stripeWebhookService");
const {
  recordBusinessSignal,
} = require("../services/businessObservabilityService");

const shouldRecordStripeWebhookOutcome = (result) => {
  if (!result || typeof result !== "object") {
    return false;
  }

  return true;
};

const getStripeWebhookSeverity = (meta = {}) => {
  if (!meta.reason && !meta.stale) {
    return "info";
  }

  if (meta.reason === "unhandled_event_type") {
    return "info";
  }

  if (meta.stale) {
    return "info";
  }

  return "warning";
};

const logStripeWebhookOutcome = async (result, event) => {
  if (!shouldRecordStripeWebhookOutcome(result)) {
    return;
  }

  const meta = result.meta || {};
  await recordBusinessSignal({
    signalType: "stripe_webhook_outcome",
    severity: getStripeWebhookSeverity(meta),
    businessId: meta.businessId || null,
    source: "stripe_webhook",
    correlationId: event?.id || null,
    action: "processed",
    reason: meta.reason || result.message || "stripe_webhook_outcome",
    entityType: "stripe_event",
    entityId: event?.id || meta.invoiceId || meta.subscriptionId || "",
    metadata: {
      message: result.message,
      eventId: event?.id || "",
      eventType: event?.type || meta.eventType || "",
      ...meta,
    },
  });
};

const recordStripeWebhookFailure = async ({
  signalType,
  severity = "error",
  reason,
  event = null,
  error = null,
}) => {
  await recordBusinessSignal({
    signalType,
    severity,
    source: "stripe_webhook",
    correlationId: event?.id || null,
    action: "failed",
    reason,
    entityType: "stripe_event",
    entityId: event?.id || "",
    metadata: {
      eventId: event?.id || "",
      eventType: event?.type || "",
      errorMessage: error?.message || "",
    },
  });
};

// Stripe webhook to fulfill credit purchases and subscription payments
const handleStripeWebhook = async (req, res) => {
  let event;

  try {
    const sig = req.headers["stripe-signature"];

    try {
      const endpointSecret = getStripeWebhookSecret();
      if (!endpointSecret) {
        await recordStripeWebhookFailure({
          signalType: "stripe_webhook_secret_missing",
          severity: "error",
          reason: "webhook_secret_not_configured",
        });
        return res.status(400).send("Webhook secret not configured");
      }

      event = stripe.webhooks.constructEvent(
        req.rawBody || req.body,
        sig,
        endpointSecret
      );

      if (!event?.type) {
        throw new Error("Invalid Stripe webhook event");
      }
    } catch (err) {
      await recordStripeWebhookFailure({
        signalType: "stripe_webhook_signature_rejected",
        severity: "warning",
        reason: "signature_verification_failed",
        error: err,
      });
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const result = await processStripeWebhookEvent(event);
    await logStripeWebhookOutcome(result, event);
    return res.status(200).send(result?.message || "Unhandled event");
  } catch (error) {
    await recordStripeWebhookFailure({
      signalType: "stripe_webhook_processing_failed",
      severity: "error",
      reason: "processing_error",
      event,
      error,
    });
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = { handleStripeWebhook, logStripeWebhookOutcome };
