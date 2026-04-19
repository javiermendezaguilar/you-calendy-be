const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/auth");
const paymentController = require("../controllers/paymentController");

router.post(
  "/checkout/:checkoutId/capture",
  isAuthenticated,
  paymentController.capturePayment
);
router.post("/:id/refund", isAuthenticated, paymentController.refundPayment);
router.get("/:id/refunds", isAuthenticated, paymentController.getRefundsByPayment);
router.get(
  "/checkout/:checkoutId",
  isAuthenticated,
  paymentController.getPaymentByCheckout
);
router.get("/:id", isAuthenticated, paymentController.getPaymentById);

module.exports = router;
