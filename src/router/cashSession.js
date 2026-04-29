const express = require("express");
const router = express.Router();
const { isAuthenticated, isBusinessOwner } = require("../middleware/auth");
const cashSessionController = require("../controllers/cashSessionController");
const { validateRequest } = require("../middleware/validateRequest");
const {
  cashSessionInputSchemas,
} = require("../validation/commerceInputSchemas");

router.post(
  "/open",
  isAuthenticated,
  isBusinessOwner,
  validateRequest(cashSessionInputSchemas.openCashSession),
  cashSessionController.openCashSession
);
router.get(
  "/active",
  isAuthenticated,
  isBusinessOwner,
  validateRequest(cashSessionInputSchemas.activeCashSession),
  cashSessionController.getActiveCashSession
);
router.get(
  "/",
  isAuthenticated,
  isBusinessOwner,
  validateRequest(cashSessionInputSchemas.listCashSessions),
  cashSessionController.listCashSessions
);
router.get(
  "/report",
  isAuthenticated,
  isBusinessOwner,
  validateRequest(cashSessionInputSchemas.cashSessionReport),
  cashSessionController.getCashSessionReport
);
router.get(
  "/:id",
  isAuthenticated,
  isBusinessOwner,
  validateRequest(cashSessionInputSchemas.cashSessionById),
  cashSessionController.getCashSessionById
);
router.post(
  "/:id/close",
  isAuthenticated,
  isBusinessOwner,
  validateRequest(cashSessionInputSchemas.closeCashSession),
  cashSessionController.closeCashSession
);

module.exports = router;
