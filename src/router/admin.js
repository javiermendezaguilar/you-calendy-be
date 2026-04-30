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
const { validateRequest } = require("../middleware/validateRequest");
const { adminInputSchemas } = require("../validation/adminInputSchemas");
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
router.post(
  "/send-email",
  validateRequest(adminInputSchemas.sendEmail),
  sendEmailToUsers
);
router.get("/recipient-groups", getRecipientGroups);

// Admin dashboard statistics
router.get("/user-stats", getUserStats);

// Backup functionality
router.post(
  "/backup",
  validateRequest(adminInputSchemas.backupCreate),
  backupController.createManualBackup
);
router.get(
  "/backup",
  validateRequest(adminInputSchemas.backupList),
  backupController.getAllBackups
);
router.get("/backup/stats", backupController.getBackupStats);
router.get(
  "/backup/:id",
  validateRequest(adminInputSchemas.backupById),
  backupController.getBackupById
);
router.get(
  "/backup/:id/download",
  validateRequest(adminInputSchemas.backupById),
  backupController.getBackupDownloadUrl
);
router.post(
  "/backup/:id/restore",
  validateRequest(adminInputSchemas.backupRestore),
  backupController.restoreFromBackup
);
router.post(
  "/backup/upload-restore",
  upload.single("backupFile"),
  validateRequest(adminInputSchemas.backupUploadRestore),
  backupController.uploadAndRestore
);
router.delete(
  "/backup/:id",
  validateRequest(adminInputSchemas.backupById),
  backupController.deleteBackup
);
router.post(
  "/backup/cleanup",
  validateRequest(adminInputSchemas.backupCleanup),
  backupController.cleanupBackups
);

// Admin stats routes
router.get(
  "/stats/appointments-trend",
  validateRequest(adminInputSchemas.adminStatsYear),
  statsController.getMonthlyAppointmentTrends
);
router.get(
  "/stats/top-barbers",
  validateRequest(adminInputSchemas.adminStatsYear),
  statsController.getTopBarberTrend
);
router.get(
  "/stats/revenue-projection",
  validateRequest(adminInputSchemas.revenueProjection),
  statsController.getGlobalRevenueProjection
);

router.put(
  "/clients/:clientId",
  validateRequest(adminInputSchemas.clientProfile),
  updateClientProfile
);
router.patch(
  "/clients/:clientId/status",
  validateRequest(adminInputSchemas.clientStatus),
  updateClientStatusByAdmin
);
router.delete(
  "/clients/:clientId",
  validateRequest(adminInputSchemas.clientById),
  deleteClientByAdmin
);

// Audit logs routes
router.get(
  "/audit-logs",
  validateRequest(adminInputSchemas.auditLogs),
  auditingController.getAuditLogs
);
router.delete(
  "/audit-logs/:logId",
  validateRequest(adminInputSchemas.auditLogById),
  auditingController.deleteAuditLog
);

module.exports = router;
