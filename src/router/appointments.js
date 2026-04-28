const express = require("express");
const router = express.Router();
const { isAuthenticated, tryAuthenticate } = require("../middleware/auth");
const checkNoShowBlock = require("../middleware/checkBlock");
const appointmentController = require("../controllers/appointmentController");
const policyChargeController = require("../controllers/policyChargeController");
const { policyChargeWriteLimiter } = require("../middleware/economicRateLimit");
const multer = require("multer");

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
});

// Public routes
router.get("/available", tryAuthenticate, appointmentController.getAvailableTimeSlots);

// Protected routes requiring authentication
router.post(
  "/", 
  isAuthenticated, 
  upload.array("referencePhotos", 5), 
  checkNoShowBlock, 
  appointmentController.createAppointment
);
router.post(
  "/barber",
  isAuthenticated,

  // upload.array("photos", 5),
  appointmentController.createAppointmentByBarber
);
router.get("/", isAuthenticated, appointmentController.getAppointments);
router.get(
  "/stats",
  isAuthenticated,
  appointmentController.getAppointmentStats
);
router.get(
  "/dashboard-stats",
  isAuthenticated,
  appointmentController.getDashboardStats
);
router.get(
  "/revenue-projection",
  isAuthenticated,
  appointmentController.getRevenueProjection
);
router.get(
  "/history",
  isAuthenticated,
  appointmentController.getAppointmentHistory
);

// Route for automated appointment reminders (must be before /:id routes)
router.post(
  "/automated-reminder",
  isAuthenticated,
  appointmentController.automatedReminder
);

// Route for getting reminder settings (must be before /:id routes)
router.get(
  "/reminder-settings",
  isAuthenticated,
  appointmentController.getReminderSettings
);

// Route for bulk updating reminder settings (must be before /:id routes)
router.put(
  "/bulk-update-reminder-settings",
  isAuthenticated,
  appointmentController.bulkUpdateReminderSettings
);

// Route for generating review links (must be before /:id routes)
router.post(
  "/generate-review-link",
  isAuthenticated,
  appointmentController.generateReviewLink
);

// Parameterized routes (must come after specific routes)
router.post(
  "/:id/policy-charges",
  isAuthenticated,
  policyChargeWriteLimiter,
  policyChargeController.createPolicyCharge
);
router.get(
  "/:id/policy-charges",
  isAuthenticated,
  policyChargeController.getAppointmentPolicyCharges
);
router.get("/:id", isAuthenticated, appointmentController.getAppointmentById);
router.put("/:id", isAuthenticated, appointmentController.updateAppointment);
router.put(
  "/:id/status",
  isAuthenticated,
  appointmentController.updateAppointmentStatus
);
router.post(
  "/:id/check-in",
  isAuthenticated,
  appointmentController.checkInAppointment
);
router.post(
  "/:id/start-service",
  isAuthenticated,
  appointmentController.startAppointmentService
);

// Penalty management routes
router.post(
  "/:id/penalty",
  isAuthenticated,
  appointmentController.applyPenalty
);
router.get(
  "/penalties/:clientId",
  isAuthenticated,
  appointmentController.getClientPenalties
);
router.put(
  "/penalties/:penaltyId/pay",
  isAuthenticated,
  appointmentController.payPenalty
);

// Delay notification routes
router.post("/:id/delay", isAuthenticated, appointmentController.notifyDelay);
router.get("/:id/delay", isAuthenticated, appointmentController.getDelayInfo);

// New route for updating appointment reminder settings
router.put(
  "/:id/reminder-settings",
  isAuthenticated,
  appointmentController.updateAppointmentReminderSettings
);

module.exports = router;
