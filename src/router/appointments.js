const express = require("express");
const router = express.Router();
const { isAuthenticated, tryAuthenticate } = require("../middleware/auth");
const checkNoShowBlock = require("../middleware/checkBlock");
const appointmentController = require("../controllers/appointmentController");
const policyChargeController = require("../controllers/policyChargeController");
const { policyChargeWriteLimiter } = require("../middleware/economicRateLimit");
const { validateRequest } = require("../middleware/validateRequest");
const {
  appointmentInputSchemas,
} = require("../validation/appointmentInputSchemas");
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
router.get(
  "/available",
  tryAuthenticate,
  validateRequest(appointmentInputSchemas.availableSlots),
  appointmentController.getAvailableTimeSlots
);

// Protected routes requiring authentication
router.post(
  "/", 
  isAuthenticated, 
  upload.array("referencePhotos", 5), 
  validateRequest(appointmentInputSchemas.createAppointment),
  checkNoShowBlock, 
  appointmentController.createAppointment
);
router.post(
  "/barber",
  isAuthenticated,

  // upload.array("photos", 5),
  validateRequest(appointmentInputSchemas.createAppointmentByBarber),
  appointmentController.createAppointmentByBarber
);
router.get(
  "/",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.listAppointments),
  appointmentController.getAppointments
);
router.get(
  "/stats",
  isAuthenticated,
  appointmentController.getAppointmentStats
);
router.get(
  "/dashboard-stats",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.dashboardStats),
  appointmentController.getDashboardStats
);
router.get(
  "/revenue-projection",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.revenueProjection),
  appointmentController.getRevenueProjection
);
router.get(
  "/history",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.appointmentHistory),
  appointmentController.getAppointmentHistory
);

// Route for automated appointment reminders (must be before /:id routes)
router.post(
  "/automated-reminder",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.automatedReminder),
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
  validateRequest(appointmentInputSchemas.bulkReminderSettings),
  appointmentController.bulkUpdateReminderSettings
);

// Route for generating review links (must be before /:id routes)
router.post(
  "/generate-review-link",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.reviewLink),
  appointmentController.generateReviewLink
);

// Parameterized routes (must come after specific routes)
router.post(
  "/:id/policy-charges",
  isAuthenticated,
  policyChargeWriteLimiter,
  validateRequest(appointmentInputSchemas.createPolicyCharge),
  policyChargeController.createPolicyCharge
);
router.get(
  "/:id/policy-charges",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.listPolicyCharges),
  policyChargeController.getAppointmentPolicyCharges
);
router.get(
  "/:id",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.appointmentById),
  appointmentController.getAppointmentById
);
router.put(
  "/:id",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.updateAppointment),
  appointmentController.updateAppointment
);
router.put(
  "/:id/status",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.updateStatus),
  appointmentController.updateAppointmentStatus
);
router.post(
  "/:id/check-in",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.checkIn),
  appointmentController.checkInAppointment
);
router.post(
  "/:id/start-service",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.startService),
  appointmentController.startAppointmentService
);

// Penalty management routes
router.post(
  "/:id/penalty",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.applyPenalty),
  appointmentController.applyPenalty
);
router.get(
  "/penalties/:clientId",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.clientPenalties),
  appointmentController.getClientPenalties
);
router.put(
  "/penalties/:penaltyId/pay",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.payPenalty),
  appointmentController.payPenalty
);

// Delay notification routes
router.post(
  "/:id/delay",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.delay),
  appointmentController.notifyDelay
);
router.get(
  "/:id/delay",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.delayInfo),
  appointmentController.getDelayInfo
);

// New route for updating appointment reminder settings
router.put(
  "/:id/reminder-settings",
  isAuthenticated,
  validateRequest(appointmentInputSchemas.updateReminderSettings),
  appointmentController.updateAppointmentReminderSettings
);

module.exports = router;
