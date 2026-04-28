const rateLimit = require("express-rate-limit");

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const createEconomicRateLimiter = ({
  windowMs = DEFAULT_WINDOW_MS,
  max = 60,
  message = "Too many economic attempts, please try again later.",
} = {}) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message,
    },
  });

const paymentWriteLimiter = createEconomicRateLimiter({
  max: parsePositiveInteger(process.env.PAYMENT_WRITE_RATE_LIMIT, 120),
  message: "Too many payment attempts, please try again later.",
});

const policyChargeWriteLimiter = createEconomicRateLimiter({
  max: parsePositiveInteger(process.env.POLICY_CHARGE_WRITE_RATE_LIMIT, 60),
  message: "Too many policy charge attempts, please try again later.",
});

const stripeWebhookLimiter = createEconomicRateLimiter({
  windowMs: 60 * 1000,
  max: parsePositiveInteger(process.env.STRIPE_WEBHOOK_RATE_LIMIT, 300),
  message: "Too many webhook attempts, please try again later.",
});

module.exports = {
  createEconomicRateLimiter,
  paymentWriteLimiter,
  policyChargeWriteLimiter,
  stripeWebhookLimiter,
};
