const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/auth");
const checkoutController = require("../controllers/checkoutController");
const { validateRequest } = require("../middleware/validateRequest");
const {
  checkoutInputSchemas,
} = require("../validation/commerceInputSchemas");

router.post(
  "/appointment/:appointmentId/open",
  isAuthenticated,
  validateRequest(checkoutInputSchemas.openCheckout),
  checkoutController.openCheckout
);
router.get(
  "/appointment/:appointmentId",
  isAuthenticated,
  validateRequest(checkoutInputSchemas.checkoutByAppointment),
  checkoutController.getCheckoutByAppointment
);
router.get(
  "/:id",
  isAuthenticated,
  validateRequest(checkoutInputSchemas.checkoutById),
  checkoutController.getCheckoutById
);
router.put(
  "/:id/service-lines",
  isAuthenticated,
  validateRequest(checkoutInputSchemas.updateServiceLines),
  checkoutController.updateServiceLines
);
router.post(
  "/:id/close",
  isAuthenticated,
  validateRequest(checkoutInputSchemas.closeCheckout),
  checkoutController.closeCheckout
);
router.post(
  "/:id/rebook",
  isAuthenticated,
  validateRequest(checkoutInputSchemas.createRebooking),
  checkoutController.createRebooking
);
router.post(
  "/:id/rebooking-outcome",
  isAuthenticated,
  validateRequest(checkoutInputSchemas.markRebookingOutcome),
  checkoutController.markRebookingOutcome
);

module.exports = router;
