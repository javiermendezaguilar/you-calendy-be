const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/auth");
const {
  requireAnyTenantCapability,
  requireTenantCapability,
} = require("../middleware/capabilityGate");
const cashSessionController = require("../controllers/cashSessionController");
const { validateRequest } = require("../middleware/validateRequest");
const {
  cashSessionInputSchemas,
} = require("../validation/commerceInputSchemas");

const requireCashReadCapability = requireAnyTenantCapability([
  "tenant.cash.open",
  "tenant.cash.close",
  "tenant.reporting.read",
]);

router.post(
  "/open",
  isAuthenticated,
  requireTenantCapability("tenant.cash.open"),
  validateRequest(cashSessionInputSchemas.openCashSession),
  cashSessionController.openCashSession
);
router.get(
  "/active",
  isAuthenticated,
  requireCashReadCapability,
  validateRequest(cashSessionInputSchemas.activeCashSession),
  cashSessionController.getActiveCashSession
);
router.get(
  "/",
  isAuthenticated,
  requireCashReadCapability,
  validateRequest(cashSessionInputSchemas.listCashSessions),
  cashSessionController.listCashSessions
);
router.get(
  "/report",
  isAuthenticated,
  requireCashReadCapability,
  validateRequest(cashSessionInputSchemas.cashSessionReport),
  cashSessionController.getCashSessionReport
);
router.get(
  "/:id",
  isAuthenticated,
  requireCashReadCapability,
  validateRequest(cashSessionInputSchemas.cashSessionById),
  cashSessionController.getCashSessionById
);
router.post(
  "/:id/close",
  isAuthenticated,
  requireTenantCapability("tenant.cash.close"),
  validateRequest(cashSessionInputSchemas.closeCashSession),
  cashSessionController.closeCashSession
);

module.exports = router;
