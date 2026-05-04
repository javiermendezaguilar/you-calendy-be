const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/auth");
const {
  requireAnyTenantCapability,
  requireTenantCapability,
} = require("../middleware/capabilityGate");
const paymentController = require("../controllers/paymentController");
const { paymentWriteLimiter } = require("../middleware/economicRateLimit");
const { validateRequest } = require("../middleware/validateRequest");
const {
  paymentInputSchemas,
} = require("../validation/commerceInputSchemas");

const requirePaymentReadCapability = requireAnyTenantCapability([
  "tenant.checkout.manage",
  "tenant.payment.capture",
  "tenant.payment.refund",
  "tenant.payment.void",
  "tenant.reporting.read",
  "tenant.reconciliation.read",
]);

router.post(
  "/checkout/:checkoutId/capture",
  isAuthenticated,
  requireTenantCapability("tenant.payment.capture"),
  paymentWriteLimiter,
  validateRequest(paymentInputSchemas.capturePayment),
  paymentController.capturePayment
);
router.get(
  "/summary",
  isAuthenticated,
  requireTenantCapability("tenant.reporting.read"),
  validateRequest(paymentInputSchemas.summaryRead),
  paymentController.getPaymentSummary
);
router.get(
  "/reconciliation",
  isAuthenticated,
  requireTenantCapability("tenant.reconciliation.read"),
  validateRequest(paymentInputSchemas.reconciliationRead),
  paymentController.getPaymentReconciliation
);
router.get(
  "/checkout/:checkoutId",
  isAuthenticated,
  requirePaymentReadCapability,
  validateRequest(paymentInputSchemas.checkoutIdRead),
  paymentController.getPaymentByCheckout
);
router.post(
  "/:id/void",
  isAuthenticated,
  requireTenantCapability("tenant.payment.void"),
  paymentWriteLimiter,
  validateRequest(paymentInputSchemas.voidPayment),
  paymentController.voidPayment
);
router.post(
  "/:id/refund",
  isAuthenticated,
  requireTenantCapability("tenant.payment.refund"),
  paymentWriteLimiter,
  validateRequest(paymentInputSchemas.refundPayment),
  paymentController.refundPayment
);
router.get(
  "/:id/refunds",
  isAuthenticated,
  requirePaymentReadCapability,
  validateRequest(paymentInputSchemas.paymentIdRead),
  paymentController.getRefundsByPayment
);
router.get(
  "/:id",
  isAuthenticated,
  requirePaymentReadCapability,
  validateRequest(paymentInputSchemas.paymentIdRead),
  paymentController.getPaymentById
);

module.exports = router;
