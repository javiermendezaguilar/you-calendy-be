const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = rateLimit;

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getAuthActor = (req) => {
  if (req.user) {
    return {
      type: req.authSession?.authSubjectType || req.user.role || "user",
      id: req.user.id || req.user._id,
    };
  }

  if (req.client) {
    return {
      type: "client",
      id: req.client.id || req.client._id,
    };
  }

  return null;
};

const actorOrIpKeyGenerator = (req) => {
  const actor = getAuthActor(req);

  if (actor?.id) {
    return `actor:${actor.type}:${actor.id}`;
  }

  return `ip:${ipKeyGenerator(req.ip)}`;
};

const createOperationalRateLimiter = ({
  windowMs = DEFAULT_WINDOW_MS,
  max = 60,
  message = "Too many attempts, please try again later.",
  keyGenerator,
} = {}) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    message: {
      success: false,
      message,
    },
  });

const createEconomicRateLimiter = (options = {}) =>
  createOperationalRateLimiter({
    message: "Too many economic attempts, please try again later.",
    ...options,
  });

const authRouterLimiter = createOperationalRateLimiter({
  max: parsePositiveInteger(process.env.AUTH_ROUTER_RATE_LIMIT, 100),
  message: "Too many authentication requests, please try again later.",
});

const authWriteLimiter = createOperationalRateLimiter({
  max: parsePositiveInteger(process.env.AUTH_WRITE_RATE_LIMIT, 10),
  message: "Too many authentication attempts, please try again later.",
  keyGenerator: actorOrIpKeyGenerator,
});

const bookingWriteLimiter = createOperationalRateLimiter({
  max: parsePositiveInteger(process.env.BOOKING_WRITE_RATE_LIMIT, 240),
  message: "Too many booking attempts, please try again later.",
  keyGenerator: actorOrIpKeyGenerator,
});

const checkoutWriteLimiter = createOperationalRateLimiter({
  max: parsePositiveInteger(process.env.CHECKOUT_WRITE_RATE_LIMIT, 180),
  message: "Too many checkout attempts, please try again later.",
  keyGenerator: actorOrIpKeyGenerator,
});

const communicationWriteLimiter = createOperationalRateLimiter({
  max: parsePositiveInteger(process.env.COMMUNICATION_WRITE_RATE_LIMIT, 60),
  message: "Too many communication attempts, please try again later.",
  keyGenerator: actorOrIpKeyGenerator,
});

const creditCheckoutWriteLimiter = createOperationalRateLimiter({
  max: parsePositiveInteger(process.env.CREDIT_CHECKOUT_RATE_LIMIT, 30),
  message: "Too many credit checkout attempts, please try again later.",
  keyGenerator: actorOrIpKeyGenerator,
});

const paymentWriteLimiter = createEconomicRateLimiter({
  max: parsePositiveInteger(process.env.PAYMENT_WRITE_RATE_LIMIT, 120),
  message: "Too many payment attempts, please try again later.",
  keyGenerator: actorOrIpKeyGenerator,
});

const policyChargeWriteLimiter = createEconomicRateLimiter({
  max: parsePositiveInteger(process.env.POLICY_CHARGE_WRITE_RATE_LIMIT, 60),
  message: "Too many policy charge attempts, please try again later.",
  keyGenerator: actorOrIpKeyGenerator,
});

const subscriptionWriteLimiter = createEconomicRateLimiter({
  max: parsePositiveInteger(process.env.SUBSCRIPTION_WRITE_RATE_LIMIT, 30),
  message: "Too many subscription attempts, please try again later.",
  keyGenerator: actorOrIpKeyGenerator,
});

const stripeWebhookLimiter = createEconomicRateLimiter({
  windowMs: 60 * 1000,
  max: parsePositiveInteger(process.env.STRIPE_WEBHOOK_RATE_LIMIT, 300),
  message: "Too many webhook attempts, please try again later.",
});

module.exports = {
  actorOrIpKeyGenerator,
  authRouterLimiter,
  authWriteLimiter,
  bookingWriteLimiter,
  checkoutWriteLimiter,
  communicationWriteLimiter,
  createEconomicRateLimiter,
  createOperationalRateLimiter,
  creditCheckoutWriteLimiter,
  paymentWriteLimiter,
  policyChargeWriteLimiter,
  subscriptionWriteLimiter,
  stripeWebhookLimiter,
};
