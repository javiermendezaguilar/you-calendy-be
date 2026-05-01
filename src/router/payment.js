const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/auth");
const paymentController = require("../controllers/paymentController");
const { paymentWriteLimiter } = require("../middleware/economicRateLimit");
const { validateRequest } = require("../middleware/validateRequest");
const {
  paymentInputSchemas,
} = require("../validation/commerceInputSchemas");

router.post(
  "/checkout/:checkoutId/capture",
  isAuthenticated,
  paymentWriteLimiter,
  validateRequest(paymentInputSchemas.capturePayment),
  paymentController.capturePayment
);
router.get(
  "/summary",
  isAuthenticated,
  validateRequest(paymentInputSchemas.summaryRead),
  paymentController.getPaymentSummary
);
router.get(
  "/reconciliation",
  isAuthenticated,
  validateRequest(paymentInputSchemas.reconciliationRead),
  paymentController.getPaymentReconciliation
);
router.get(
  "/checkout/:checkoutId",
  isAuthenticated,
  validateRequest(paymentInputSchemas.checkoutIdRead),
  paymentController.getPaymentByCheckout
);
router.post(
  "/:id/void",
  isAuthenticated,
  paymentWriteLimiter,
  validateRequest(paymentInputSchemas.voidPayment),
  paymentController.voidPayment
);
router.post(
  "/:id/refund",
  isAuthenticated,
  paymentWriteLimiter,
  validateRequest(paymentInputSchemas.refundPayment),
  paymentController.refundPayment
);
router.get(
  "/:id/refunds",
  isAuthenticated,
  validateRequest(paymentInputSchemas.paymentIdRead),
  paymentController.getRefundsByPayment
);
router.get(
  "/:id",
  isAuthenticated,
  validateRequest(paymentInputSchemas.paymentIdRead),
  paymentController.getPaymentById
);

module.exports = router;
