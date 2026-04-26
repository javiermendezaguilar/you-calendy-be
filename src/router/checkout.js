const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/auth");
const checkoutController = require("../controllers/checkoutController");

router.post(
  "/appointment/:appointmentId/open",
  isAuthenticated,
  checkoutController.openCheckout
);
router.get(
  "/appointment/:appointmentId",
  isAuthenticated,
  checkoutController.getCheckoutByAppointment
);
router.get("/:id", isAuthenticated, checkoutController.getCheckoutById);
router.put(
  "/:id/service-lines",
  isAuthenticated,
  checkoutController.updateServiceLines
);
router.post("/:id/close", isAuthenticated, checkoutController.closeCheckout);
router.post("/:id/rebook", isAuthenticated, checkoutController.createRebooking);
router.post(
  "/:id/rebooking-outcome",
  isAuthenticated,
  checkoutController.markRebookingOutcome
);

module.exports = router;
