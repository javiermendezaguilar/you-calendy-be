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

const stripeIdSchema = z.string().trim().min(1);
const stripeCustomerSchema = z.union([stripeIdSchema, z.null()]);
const stripeMetadataSchema = z.record(z.string(), z.string());

const createSubscriptionRequestSchema = z
  .object({
    priceId: z.string().trim().min(1, "priceId is required"),
  })
  .strict();

const stripeSubscriptionSchema = z
  .object({
    id: stripeIdSchema,
    status: subscriptionStatusSchema,
    customer: stripeCustomerSchema.optional(),
    metadata: stripeMetadataSchema.optional(),
  })
  .passthrough();

const stripeCheckoutSessionSchema = z
  .object({
    id: stripeIdSchema,
    mode: z.string().optional(),
    subscription: stripeCustomerSchema.optional(),
    metadata: stripeMetadataSchema.optional(),
  })
  .passthrough();

module.exports = {
  createSubscriptionRequestSchema,
  stripeCheckoutSessionSchema,
  stripeSubscriptionSchema,
};
