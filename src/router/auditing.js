const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/auth");
const auditingController = require("../controllers/auditingController");

router.get("/", isAuthenticated, auditingController.getAuditLogs);
router.delete("/:logId", isAuthenticated, auditingController.deleteAuditLog);

module.exports = router;
