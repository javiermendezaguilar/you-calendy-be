const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/auth");
const paymentController = require("../controllers/paymentController");
const { paymentWriteLimiter } = require("../middleware/economicRateLimit");

router.post(
  "/checkout/:checkoutId/capture",
  isAuthenticated,
  paymentWriteLimiter,
  paymentController.capturePayment
);
router.get("/summary", isAuthenticated, paymentController.getPaymentSummary);
router.get(
  "/reconciliation",
  isAuthenticated,
  paymentController.getPaymentReconciliation
);
router.get(
  "/checkout/:checkoutId",
  isAuthenticated,
  paymentController.getPaymentByCheckout
);
router.post(
  "/:id/void",
  isAuthenticated,
  paymentWriteLimiter,
  paymentController.voidPayment
);
router.post(
  "/:id/refund",
  isAuthenticated,
  paymentWriteLimiter,
  paymentController.refundPayment
);
router.get("/:id/refunds", isAuthenticated, paymentController.getRefundsByPayment);
router.get("/:id", isAuthenticated, paymentController.getPaymentById);

module.exports = router;
