const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/auth");
const { requireTenantCapability } = require("../middleware/capabilityGate");
const { checkoutWriteLimiter } = require("../middleware/economicRateLimit");
const checkoutController = require("../controllers/checkoutController");
const { validateRequest } = require("../middleware/validateRequest");
const {
  checkoutInputSchemas,
} = require("../validation/commerceInputSchemas");

router.post(
  "/appointment/:appointmentId/open",
  isAuthenticated,
  requireTenantCapability("tenant.checkout.manage"),
  checkoutWriteLimiter,
  validateRequest(checkoutInputSchemas.openCheckout),
  checkoutController.openCheckout
);
router.get(
  "/appointment/:appointmentId",
  isAuthenticated,
  requireTenantCapability("tenant.checkout.manage"),
  validateRequest(checkoutInputSchemas.checkoutByAppointment),
  checkoutController.getCheckoutByAppointment
);
router.get(
  "/:id",
  isAuthenticated,
  requireTenantCapability("tenant.checkout.manage"),
  validateRequest(checkoutInputSchemas.checkoutById),
  checkoutController.getCheckoutById
);
router.put(
  "/:id/service-lines",
  isAuthenticated,
  requireTenantCapability("tenant.checkout.manage"),
  checkoutWriteLimiter,
  validateRequest(checkoutInputSchemas.updateServiceLines),
  checkoutController.updateServiceLines
);
router.post(
  "/:id/close",
  isAuthenticated,
  requireTenantCapability("tenant.checkout.manage"),
  checkoutWriteLimiter,
  validateRequest(checkoutInputSchemas.closeCheckout),
  checkoutController.closeCheckout
);
router.post(
  "/:id/rebook",
  isAuthenticated,
  requireTenantCapability("tenant.checkout.manage"),
  checkoutWriteLimiter,
  validateRequest(checkoutInputSchemas.createRebooking),
  checkoutController.createRebooking
);
router.post(
  "/:id/rebooking-outcome",
  isAuthenticated,
  requireTenantCapability("tenant.checkout.manage"),
  checkoutWriteLimiter,
  validateRequest(checkoutInputSchemas.markRebookingOutcome),
  checkoutController.markRebookingOutcome
);

module.exports = router;
