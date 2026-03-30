const express = require("express");
const router = express.Router();
const {
  sendEmailToUsers,
  getUserStats,
  getRecipientGroups,
  updateClientProfile,
  updateClientStatusByAdmin,
  deleteClientByAdmin,
} = require("../controllers/adminController");
const backupController = require("../controllers/backupController");
const auditingController = require("../controllers/auditingController");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const multer = require("multer");
const statsController = require("../controllers/statsController");

// Multer configuration for file uploads (memory storage for Cloudinary)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Allow only JSON files for backup uploads
    if (
      file.mimetype === "application/json" ||
      file.originalname.endsWith(".json")
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only JSON files are allowed for backup uploads."
        ),
        false
      );
    }
  },
});

// All admin routes require admin authentication
router.use(isAuthenticated, isAdmin);

// Email functionality
router.post("/send-email", sendEmailToUsers);
router.get("/recipient-groups", getRecipientGroups);

// Admin dashboard statistics
router.get("/user-stats", getUserStats);

// Backup functionality
router.post("/backup", backupController.createManualBackup);
router.get("/backup", backupController.getAllBackups);
router.get("/backup/stats", backupController.getBackupStats);
router.get("/backup/:id", backupController.getBackupById);
router.get("/backup/:id/download", backupController.getBackupDownloadUrl);
router.post("/backup/:id/restore", backupController.restoreFromBackup);
router.post(
  "/backup/upload-restore",
  upload.single("backupFile"),
  backupController.uploadAndRestore
);
router.delete("/backup/:id", backupController.deleteBackup);
router.post("/backup/cleanup", backupController.cleanupBackups);

// Admin stats routes
router.get(
  "/stats/appointments-trend",
  statsController.getMonthlyAppointmentTrends
);
router.get("/stats/top-barbers", statsController.getTopBarberTrend);
router.get(
  "/stats/revenue-projection",
  statsController.getGlobalRevenueProjection
);

router.put("/clients/:clientId", updateClientProfile);
router.patch("/clients/:clientId/status", updateClientStatusByAdmin);
router.delete("/clients/:clientId", deleteClientByAdmin);

// Audit logs routes
router.get("/audit-logs", auditingController.getAuditLogs);
router.delete("/audit-logs/:logId", auditingController.deleteAuditLog);

module.exports = router;
