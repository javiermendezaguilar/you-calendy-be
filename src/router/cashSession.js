const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/auth");
const cashSessionController = require("../controllers/cashSessionController");

router.post("/open", isAuthenticated, cashSessionController.openCashSession);
router.get("/active", isAuthenticated, cashSessionController.getActiveCashSession);
router.get("/:id", isAuthenticated, cashSessionController.getCashSessionById);
router.post("/:id/close", isAuthenticated, cashSessionController.closeCashSession);

module.exports = router;
