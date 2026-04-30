const express = require("express");
const { isAuthenticated, isBusinessOwner } = require("../middleware/auth");
const router = express.Router();
const multer = require("multer");
const businessController = require("../controllers/businessController");
const staffController = require("../controllers/staffController");
const clientController = require("../controllers/clientController");
const haircutGalleryController = require("../controllers/haircutGalleryController");
const messageBlastController = require("../controllers/messageBlastController");
const visitController = require("../controllers/visitController");
const { validateRequest } = require("../middleware/validateRequest");
const {
  bookingWriteLimiter,
  communicationWriteLimiter,
  subscriptionWriteLimiter,
} = require("../middleware/economicRateLimit");
const { serviceInputSchemas } = require("../validation/serviceInputSchemas");

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
});

// Business CRUD routes - Note: Create business removed as it's handled by auth/register
router.get("/", isAuthenticated, businessController.getUserBusiness);
router.get(
  "/operational-dashboard",
  isAuthenticated,
  businessController.getOperationalDashboard
);
router.get(
  "/operational-reporting",
  isAuthenticated,
  businessController.getOperationalReporting
);
router.get(
  "/domain-events",
  isAuthenticated,
  businessController.getDomainEvents
);
router.get(
  "/onboarding-status",
  isAuthenticated,
  businessController.getOnboardingStatus
);
router.get(
  "/visits",
  isAuthenticated,
  visitController.getBusinessVisits
);
router.put("/", isAuthenticated, businessController.updateBusinessProfile);

// Business info routes
router.put("/info", isAuthenticated, businessController.updateBusinessInfo);

// Business address & location routes
router.put(
  "/address",
  isAuthenticated,
  businessController.updateBusinessAddress
);
router.put(
  "/location",
  isAuthenticated,
  businessController.updateBusinessLocation
);

// Business hours routes
router.put("/hours", isAuthenticated, businessController.updateBusinessHours);

// Business services routes
router.get(
  "/services",
  isAuthenticated,
  businessController.getBusinessServices
);
router.post(
  "/services",
  isAuthenticated,
  validateRequest(serviceInputSchemas.createBusinessService),
  businessController.addBusinessService
);
router.put(
  "/services/:serviceId",
  isAuthenticated,
  validateRequest(serviceInputSchemas.updateBusinessService),
  businessController.updateBusinessService
);
router.delete(
  "/services/:serviceId",
  isAuthenticated,
  validateRequest(serviceInputSchemas.deleteBusinessService),
  businessController.deleteBusinessService
);
router.post(
  "/waitlist",
  isAuthenticated,
  bookingWriteLimiter,
  businessController.createWaitlistEntry
);
router.get(
  "/waitlist",
  isAuthenticated,
  businessController.getWaitlistEntries
);
router.get(
  "/waitlist/fill-gaps",
  isAuthenticated,
  businessController.getWaitlistFillGaps
);
router.post(
  "/waitlist/find-match",
  isAuthenticated,
  bookingWriteLimiter,
  businessController.findWaitlistMatches
);

// Business settings routes (logo, workplace photos, gallery images)
router.get(
  "/settings",
  isAuthenticated,
  businessController.getBusinessSettings
);
router.put(
  "/settings",
  isAuthenticated,
  upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "workplacePhotos", maxCount: 10 },
    { name: "galleryImages", maxCount: 20 },
  ]),
  businessController.updateBusinessSettings
);

// Business appointments route
router.get(
  "/appointments",
  isAuthenticated,
  require("../controllers/appointmentController").getBusinessAppointments
);

// Staff management routes
router.post("/staff", isAuthenticated, staffController.addStaffMember);
router.get("/staff", isAuthenticated, staffController.getStaffMembers);
router.get("/get-staff-client", staffController.getStaffMembers);
router.get(
  "/staff/:staffId",
  isAuthenticated,
  staffController.getStaffMemberById
);
router.put(
  "/staff/:staffId",
  isAuthenticated,
  staffController.updateStaffMember
);
router.delete(
  "/staff/:staffId",
  isAuthenticated,
  staffController.deleteStaffMember
);

// New enhanced staff routesasfsdf
router.post(
  "/staff/:staffId/replicate-schedule",
  isAuthenticated,
  staffController.replicateSchedule
);
router.get(
  "/staff/:staffId/working-hours",
  isAuthenticated,
  staffController.getWorkingHoursByStaffId
);
router.get(
  "/staff/:staffId/working-hours/client-side",
  // isAuthenticated,
  staffController.getWorkingHoursByStaffId
);

// Client management routes
router.post("/clients", isAuthenticated, clientController.addClient);
router.get(
  "/clients",
  isAuthenticated,
  isBusinessOwner,
  clientController.getClients
);
router.get(
  "/clients/count",
  isAuthenticated,
  isBusinessOwner,
  clientController.getClientsCount
);

// Client phone and messaging routes (must be before parameterized routes)
router.get(
  "/clients/phones-simple",
  isAuthenticated,
  clientController.getClientPhone
);
router.post(
  "/clients/messages",
  isAuthenticated,
  communicationWriteLimiter,
  clientController.sendCustomMessageToClients
);

// Client notes, suggestions, and reports routes (must be before parameterized routes)
router.get(
  "/clients/note-counts",
  isAuthenticated,
  clientController.getClientNoteCounts
);
router.get(
  "/clients/suggestions",
  isAuthenticated,
  clientController.getClientSuggestions
);
router.get(
  "/clients/reports",
  isAuthenticated,
  clientController.getClientReports
);
router.put(
  "/clients/reports/:reportId",
  isAuthenticated,
  clientController.updateReportStatus
);
router.post(
  "/clients/notes/:noteId/respond",
  isAuthenticated,
  clientController.respondToClientNote
);
router.post(
  "/clients/:clientId/suggestions",
  isAuthenticated,
  clientController.addClientSuggestion
);
router.post(
  "/clients/:clientId/reports",
  isAuthenticated,
  clientController.addClientReport
);

// Client management routes with parameters
router.get(
  "/clients/:clientId",
  isAuthenticated,
  clientController.getClientById
);
router.post(
  "/clients/:clientId/lifecycle/refresh",
  isAuthenticated,
  clientController.refreshClientLifecycle
);
router.patch(
  "/clients/:clientId/consent",
  isAuthenticated,
  clientController.updateClientConsent
);
router.put(
  "/clients/:clientId",
  isAuthenticated,
  upload.single("profileImage"),
  clientController.updateClient
);
router.put(
  "/clients/:clientId/private-notes",
  isAuthenticated,
  clientController.updatePrivateNotes
);
router.delete(
  "/clients/:clientId",
  isAuthenticated,
  clientController.deleteClient
);
router.put(
  "/clients/:clientId/unblock",
  isAuthenticated,
  clientController.unblockClient
);

// Client invitation link routes
router.get(
  "/clients/:clientId/invitation-link",
  isAuthenticated,
  clientController.getInvitationLink
);
router.post(
  "/clients/:clientId/update-link",
  isAuthenticated,
  communicationWriteLimiter,
  clientController.updateClientInvitationToken
);
router.post(
  "/clients/:clientId/resend-invitation",
  isAuthenticated,
  communicationWriteLimiter,
  clientController.resendInvitationSMS
);

// Client notification routes
router.get(
  "/clients/:clientId/notifications",
  isAuthenticated,
  clientController.getClientNotificationPreferences
);
router.patch(
  "/clients/:clientId/notifications",
  isAuthenticated,
  clientController.toggleClientNotifications
);

// Haircut Gallery routes
router.post(
  "/clients/:clientId/gallery",
  isAuthenticated,
  upload.single("image"),
  haircutGalleryController.uploadHaircutImage
);
router.get(
  "/clients/:clientId/gallery",
  isAuthenticated,
  haircutGalleryController.getClientGallery
);
router.post(
  "/gallery/:galleryId/suggestions",
  isAuthenticated,
  upload.single("image"),
  haircutGalleryController.addSuggestion
);
router.post(
  "/gallery/:galleryId/reports",
  isAuthenticated,
  upload.single("image"),
  haircutGalleryController.reportImage
);
router.get(
  "/gallery/reports",
  isAuthenticated,
  haircutGalleryController.getReportedImages
);
router.put(
  "/gallery/reports/:galleryId/:reportId",
  isAuthenticated,
  haircutGalleryController.reviewReport
);
router.delete(
  "/gallery/:galleryId",
  isAuthenticated,
  haircutGalleryController.deleteGalleryImage
);
router.put(
  "/gallery/:galleryId/suggestions/:suggestionId",
  isAuthenticated,
  haircutGalleryController.editSuggestion
);

// Message blast routes
router.post(
  "/message-blast/email",
  isAuthenticated,
  communicationWriteLimiter,
  messageBlastController.sendEmailBlast
);
router.get(
  "/message-blast/recipient-groups",
  isAuthenticated,
  messageBlastController.getRecipientGroups
);
router.get(
  "/message-blast/stats",
  isAuthenticated,
  messageBlastController.getMessageBlastStats
);

// Business freemium/premium routes
router.post(
  "/start-trial",
  isAuthenticated,
  subscriptionWriteLimiter,
  businessController.startFreeTrial
);
router.get(
  "/subscription-status",
  isAuthenticated,
  isBusinessOwner,
  businessController.getSubscriptionStatus
);
router.get(
  "/entitlements",
  isAuthenticated,
  isBusinessOwner,
  businessController.getBusinessEntitlements
);
router.post(
  "/create-subscription",
  isAuthenticated,
  subscriptionWriteLimiter,
  businessController.createStripeSubscription
);
// router.post("/test-webhook", isAuthenticated, businessController.testWebhook);

// Email marketing routes
router.post(
  "/email-campaigns",
  isAuthenticated,
  upload.single("image"),
  businessController.createEmailCampaign
);
router.get(
  "/email-campaigns",
  isAuthenticated,
  businessController.getEmailCampaigns
);
router.put(
  "/email-campaigns/:campaignId",
  isAuthenticated,
  upload.single("image"),
  businessController.updateEmailCampaign
);
router.delete(
  "/email-campaigns/:campaignId",
  isAuthenticated,
  businessController.deleteEmailCampaign
);
router.post(
  "/email-campaigns/:campaignId/send",
  isAuthenticated,
  communicationWriteLimiter,
  businessController.sendEmailCampaign
);
router.post(
  "/email-campaigns/process",
  isAuthenticated,
  communicationWriteLimiter,
  businessController.triggerEmailCampaignProcessing
);
router.get(
  "/email-campaigns/scheduler-status",
  isAuthenticated,
  businessController.getEmailCampaignSchedulerStatus
);

// SMS marketing routes
router.post(
  "/sms-campaigns",
  isAuthenticated,
  communicationWriteLimiter,
  businessController.createSmsCampaign
);

router.post(
  "/check-campaign-credits",
  isAuthenticated,
  businessController.checkCampaignCredits
);

// Barber link routes
router.get("/barber-link", isAuthenticated, businessController.getBarberLink);
router.post(
  "/barber-link/regenerate",
  isAuthenticated,
  businessController.regenerateBarberLink
);

// Client check route (public - for sign-in flow)
router.post(
  "/client-check",
  businessController.checkClientExists
);

// Client profile routes
router.post(
  "/client-profiles",
  // isAuthenticated,
  upload.single("profileImage"),
  businessController.createClientProfile
);

// Unregistered client routes (for walk-ins, phone bookings)
router.post(
  "/walk-ins",
  isAuthenticated,
  bookingWriteLimiter,
  businessController.createWalkIn
);
router.post(
  "/walk-ins/:appointmentId/abandon",
  isAuthenticated,
  bookingWriteLimiter,
  businessController.abandonWalkIn
);
router.get(
  "/walk-ins/queue",
  isAuthenticated,
  businessController.getWalkInQueue
);
router.post(
  "/unregistered-client",
  isAuthenticated,
  bookingWriteLimiter,
  upload.array("haircutPhotos"),
  businessController.createUnregisteredClient
);

// Convert unregistered client to registered
router.post(
  "/clients/:clientId/convert-to-registered",
  isAuthenticated,
  bookingWriteLimiter,
  businessController.convertClientToRegistered
);
// router.get(
//   "/client-profiles",
//   isAuthenticated,
//   businessController.getClientProfiles
// );
// router.get(
//   "/client-profiles/:clientId",
//   isAuthenticated,
//   businessController.getClientProfile
// );
// router.put(
//   "/client-profiles/:clientId",
//   isAuthenticated,
//   businessController.updateClientProfile
// );
// router.delete(
//   "/client-profiles/:clientId",
//   isAuthenticated,
//   businessController.deleteClientProfile
// );
// router.patch(
//   "/client-profiles/:clientId/toggle-status",
//   isAuthenticated,
//   businessController.toggleClientProfileStatus
// );

router.get("/:id", businessController.getBusinessById);

module.exports = router;
