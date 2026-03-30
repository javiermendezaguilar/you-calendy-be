const stripe = require("stripe")(process.env.STRIPE_SECRET);
const ErrorHandler = require("../utils/ErrorHandler");
const SuccessHandler = require("../utils/SuccessHandler");
const CreditProduct = require("../models/creditProduct");
const Business = require("../models/User/business");

// Stripe webhook to fulfill credit purchases and subscription payments
const handleStripeWebhook = async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      const endpointSecret = process.env.WEBHOOK_SECRET_ONE;
      if (!endpointSecret) {
        console.error("WEBHOOK_SECRET_ONE is not configured");
        return res.status(400).send("Webhook secret not configured");
      }

      event = stripe.webhooks.constructEvent(
        req.rawBody || req.body,
        sig,
        endpointSecret
      );

      console.log(`Received webhook event: ${event.type}`);

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        // Handle credit purchases
        if (session.metadata && session.metadata.type === "credit_purchase") {
          console.log(`Processing credit purchase for session: ${session.id}`);

          const businessId = session.metadata.businessId;
          const ownerId = session.metadata.ownerId;

          if (!businessId) {
            console.error("No businessId found in session metadata");
            return res
              .status(400)
              .send("Business ID not found in session metadata");
          }

          // Retrieve line items to get price/product
          const lineItems = await stripe.checkout.sessions.listLineItems(
            session.id,
            { limit: 1 }
          );

          const priceId =
            lineItems.data[0]?.price?.id || session.line_items?.[0]?.price?.id;
          if (!priceId) {
            console.error(`No price found for session: ${session.id}`);
            return res.status(400).send("No price found in session");
          }

          console.log(`Found price ID: ${priceId}`);

          // Find the credit product
          const productDoc = await CreditProduct.findOne({
            stripePriceId: priceId,
            isActive: true,
          });

          if (!productDoc) {
            console.error(
              `No active credit product found for price ID: ${priceId}`
            );
            return res
              .status(400)
              .send("No matching active credit product found");
          }

          console.log(
            `Found credit product: ${productDoc.title}, SMS: ${productDoc.smsCredits}, Email: ${productDoc.emailCredits}`
          );

          // Find the business
          const business = await Business.findById(businessId);
          if (!business) {
            console.error(`Business not found for ID: ${businessId}`);
            return res.status(400).send("Business not found");
          }

          // Verify the business owner matches
          if (ownerId && business.owner.toString() !== ownerId) {
            console.error(
              `Business owner mismatch. Expected: ${ownerId}, Found: ${business.owner}`
            );
            return res.status(400).send("Business owner mismatch");
          }

          // Update credits
          const previousSmsCredits = business.smsCredits || 0;
          const previousEmailCredits = business.emailCredits || 0;

          business.smsCredits =
            previousSmsCredits + (productDoc.smsCredits || 0);
          business.emailCredits =
            previousEmailCredits + (productDoc.emailCredits || 0);

          await business.save();

          console.log(
            `Credits updated successfully. Business: ${businessId}, SMS: ${previousSmsCredits} -> ${business.smsCredits}, Email: ${previousEmailCredits} -> ${business.emailCredits}`
          );

          return res.status(200).send("Credits added successfully");
        }

        // Handle subscription payments (when trial has ended)
        if (
          session.metadata &&
          session.metadata.businessId &&
          session.mode === "subscription"
        ) {
          const businessId = session.metadata.businessId;
          const business = await Business.findById(businessId);
          if (!business)
            return res.status(200).send("Business not found, skipping");

          // Get the subscription from the session
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription
          );

          // Update business with subscription details
          business.stripeSubscriptionId = subscription.id;
          business.subscriptionStatus = subscription.status;

          // Clear trial data since subscription is now active
          if (subscription.status === "active") {
            business.trialEnd = null;
            business.trialStart = null;
          }

          await business.save();
          return res.status(200).send("Subscription activated");
        }
      }
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }

  // try {
  //   if (event.type === "checkout.session.completed") {
  //     const session = event.data.object;

  //     // Handle credit purchases
  //     if (session.metadata && session.metadata.type === "credit_purchase") {
  //       console.log(`Processing credit purchase for session: ${session.id}`);

  //       const businessId = session.metadata.businessId;
  //       const ownerId = session.metadata.ownerId;

  //       if (!businessId) {
  //         console.error("No businessId found in session metadata");
  //         return res
  //           .status(400)
  //           .send("Business ID not found in session metadata");
  //       }

  //       // Retrieve line items to get price/product
  //       const lineItems = await stripe.checkout.sessions.listLineItems(
  //         session.id,
  //         { limit: 1 }
  //       );

  //       const priceId =
  //         lineItems.data[0]?.price?.id || session.line_items?.[0]?.price?.id;
  //       if (!priceId) {
  //         console.error(`No price found for session: ${session.id}`);
  //         return res.status(400).send("No price found in session");
  //       }

  //       console.log(`Found price ID: ${priceId}`);

  //       // Find the credit product
  //       const productDoc = await CreditProduct.findOne({
  //         stripePriceId: priceId,
  //         isActive: true,
  //       });

  //       if (!productDoc) {
  //         console.error(
  //           `No active credit product found for price ID: ${priceId}`
  //         );
  //         return res
  //           .status(400)
  //           .send("No matching active credit product found");
  //       }

  //       console.log(
  //         `Found credit product: ${productDoc.title}, SMS: ${productDoc.smsCredits}, Email: ${productDoc.emailCredits}`
  //       );

  //       // Find the business
  //       const business = await Business.findById(businessId);
  //       if (!business) {
  //         console.error(`Business not found for ID: ${businessId}`);
  //         return res.status(400).send("Business not found");
  //       }

  //       // Verify the business owner matches
  //       if (ownerId && business.owner.toString() !== ownerId) {
  //         console.error(
  //           `Business owner mismatch. Expected: ${ownerId}, Found: ${business.owner}`
  //         );
  //         return res.status(400).send("Business owner mismatch");
  //       }

  //       // Update credits
  //       const previousSmsCredits = business.smsCredits || 0;
  //       const previousEmailCredits = business.emailCredits || 0;

  //       business.smsCredits = previousSmsCredits + (productDoc.smsCredits || 0);
  //       business.emailCredits =
  //         previousEmailCredits + (productDoc.emailCredits || 0);

  //       await business.save();

  //       console.log(
  //         `Credits updated successfully. Business: ${businessId}, SMS: ${previousSmsCredits} -> ${business.smsCredits}, Email: ${previousEmailCredits} -> ${business.emailCredits}`
  //       );

  //       return res.status(200).send("Credits added successfully");
  //     }

  //     // Handle subscription payments (when trial has ended)
  //     if (
  //       session.metadata &&
  //       session.metadata.businessId &&
  //       session.mode === "subscription"
  //     ) {
  //       const businessId = session.metadata.businessId;
  //       const business = await Business.findById(businessId);
  //       if (!business)
  //         return res.status(200).send("Business not found, skipping");

  //       // Get the subscription from the session
  //       const subscription = await stripe.subscriptions.retrieve(
  //         session.subscription
  //       );

  //       // Update business with subscription details
  //       business.stripeSubscriptionId = subscription.id;
  //       business.subscriptionStatus = subscription.status;

  //       // Clear trial data since subscription is now active
  //       if (subscription.status === "active") {
  //         business.trialEnd = null;
  //         business.trialStart = null;
  //       }

  //       await business.save();
  //       return res.status(200).send("Subscription activated");
  //     }
  //   }

  //   // Handle subscription lifecycle events
  //   if (
  //     event.type === "customer.subscription.updated" ||
  //     event.type === "customer.subscription.created"
  //   ) {
  //     const subscription = event.data.object;
  //     const businessId = subscription.metadata.businessId;
  //     if (businessId) {
  //       const business = await Business.findById(businessId);
  //       if (business) {
  //         // Use the same logic as businessController for consistency
  //         // business.stripeSubscriptionId = subscription.id;
  //         business.subscriptionStatus = subscription.status;
  //         if (subscription.status === "active") {
  //           business.trialEnd = null;
  //           business.trialStart = null;
  //         }
  //         await business.save();
  //       }
  //     }
  //     return res.status(200).send("Subscription updated");
  //   }

  //   if (event.type === "customer.subscription.deleted") {
  //     const subscription = event.data.object;
  //     const businessId = subscription.metadata.businessId;
  //     if (businessId) {
  //       const business = await Business.findById(businessId);
  //       if (business) {
  //         business.subscriptionStatus = "canceled";
  //         await business.save();
  //       }
  //     }
  //     return res.status(200).send("Subscription canceled");
  //   }

  //   console.log(`Unhandled event type: ${event.type}`);
  //   return res.status(200).send("Unhandled event");
  // } catch (error) {
  //   console.error("Webhook processing error:", error);
  //   return ErrorHandler(error.message, 500, req, res);
  // }
};

module.exports = { handleStripeWebhook };
