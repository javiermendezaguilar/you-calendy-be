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
    customer: stripeCustomerSchema.optional(),
    currency: z.string().trim().min(1).optional(),
    amount_total: z.number().nonnegative().optional(),
    payment_status: z.string().trim().min(1).optional(),
    metadata: stripeMetadataSchema.optional(),
  })
  .passthrough();

const stripeInvoiceLineSchema = z
  .object({
    metadata: stripeMetadataSchema.optional(),
  })
  .passthrough();

const stripeInvoiceSchema = z
  .object({
    id: stripeIdSchema,
    customer: stripeCustomerSchema.optional(),
    subscription: stripeCustomerSchema.optional(),
    currency: z.string().trim().min(1).optional(),
    amount_paid: z.number().nonnegative().optional(),
    number: z.union([z.string().trim().min(1), z.null()]).optional(),
    created: z.number().int().nonnegative().optional(),
    metadata: stripeMetadataSchema.optional(),
    lines: z
      .union([
        z.object({
          data: z.array(stripeInvoiceLineSchema).optional(),
        }),
        z.null(),
      ])
      .optional(),
    parent: z
      .union([
        z.object({
          subscription_details: z
            .union([
              z.object({
                metadata: stripeMetadataSchema.optional(),
              }),
              z.null(),
            ])
            .optional(),
        }),
        z.null(),
      ])
      .optional(),
    status_transitions: z
      .union([
        z.object({
          paid_at: z.union([z.number().int().nonnegative(), z.null()]).optional(),
        }),
        z.null(),
      ])
      .optional(),
  })
  .passthrough();

module.exports = {
  createSubscriptionRequestSchema,
  stripeCheckoutSessionSchema,
  stripeSubscriptionSchema,
  stripeInvoiceSchema,
};
