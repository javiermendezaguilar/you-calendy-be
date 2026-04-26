const express = require("express");
const router = express.Router();
const { isAuthenticated, isBusinessOwner } = require("../middleware/auth");
const cashSessionController = require("../controllers/cashSessionController");

router.post(
  "/open",
  isAuthenticated,
  isBusinessOwner,
  cashSessionController.openCashSession
);
router.get(
  "/active",
  isAuthenticated,
  isBusinessOwner,
  cashSessionController.getActiveCashSession
);
router.get(
  "/",
  isAuthenticated,
  isBusinessOwner,
  cashSessionController.listCashSessions
);
router.get(
  "/report",
  isAuthenticated,
  isBusinessOwner,
  cashSessionController.getCashSessionReport
);
router.get(
  "/:id",
  isAuthenticated,
  isBusinessOwner,
  cashSessionController.getCashSessionById
);
router.post(
  "/:id/close",
  isAuthenticated,
  isBusinessOwner,
  cashSessionController.closeCashSession
);

module.exports = router;
