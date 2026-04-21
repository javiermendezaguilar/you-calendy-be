const { z } = require("zod");

const subscriptionStatusSchema = z.enum([
  "none",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

const createSubscriptionRequestSchema = z
  .object({
    priceId: z.string().trim().min(1, "priceId is required"),
  })
  .strict();

const stripeSubscriptionSchema = z
  .object({
    id: z.string().trim().min(1),
    status: subscriptionStatusSchema,
    customer: z.union([z.string().trim().min(1), z.null()]).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const stripeCheckoutSessionSchema = z
  .object({
    id: z.string().trim().min(1),
    mode: z.string().optional(),
    subscription: z.union([z.string().trim().min(1), z.null()]).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

module.exports = {
  createSubscriptionRequestSchema,
  stripeCheckoutSessionSchema,
  stripeSubscriptionSchema,
};
