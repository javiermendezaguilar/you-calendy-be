const express = require("express");
const router = express.Router();
const clientController = require("../controllers/clientController");
const haircutGalleryController = require("../controllers/haircutGalleryController");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const uploader = require("../utils/uploader");

// Public client access routes (no authentication required)
router.get("/invitation/:token", clientController.getClientByInvitationToken);
router.get("/business/:businessId", clientController.getBusinessDetails);
router.get(
  "/business/:businessId/gallery",
  clientController.getBusinessGallery
);
router.post("/login", clientController.clientLogin);
router.post("/logout", clientController.clientLogout);
router.post("/signup", clientController.clientSignUp);
router.post("/signin", clientController.clientSignIn);
router.post("/forgot-password", clientController.clientForgotPassword);
router.post("/reset-password", clientController.clientResetPassword);
router.post(
  "/complete-profile",
  uploader.single("profileImage"),
  clientController.completeClientProfile
);

// Client-side profile routes
router.get("/profile/:clientId", clientController.getPublicClientProfile);
router.get("/profile", isAuthenticated, clientController.getClientProfile);
router.patch(
  "/profile",
  isAuthenticated,
  uploader.single("profileImage"),
  clientController.updateClientProfile
);
router.delete("/profile", isAuthenticated, clientController.deleteClientProfile);

// Client-side notification routes
router.get(
  "/notifications",
  isAuthenticated,
  clientController.getClientOwnNotificationPreferences
);
router.patch(
  "/notifications",
  isAuthenticated,
  clientController.toggleClientOwnNotifications
);

// Client gallery routes
router.get("/gallery/:clientId", clientController.getClientGalleryByClient);
router.post(
  "/gallery/:clientId",
  uploader.single("image"),
  haircutGalleryController.uploadHaircutImageByClient
);
router.post(
  "/gallery/:galleryId/suggestions",
  uploader.single("image"),
  haircutGalleryController.addSuggestionByClient
);
router.post(
  "/gallery/:galleryId/reports",
  uploader.single("image"),
  haircutGalleryController.reportImageByClient
);
router.delete(
  "/gallery/:galleryId",
  haircutGalleryController.deleteGalleryImageByClient
);

// Admin routes
router.get("/all", isAuthenticated, isAdmin, clientController.getAllClient);
router.get("/phone", isAuthenticated, clientController.getClientPhone);
router.post(
  "/send-custom-message",
  isAuthenticated,
  clientController.sendCustomMessageToClients
);
router.patch(
  "/:id/status",
  isAuthenticated,
  isAdmin,
  clientController.updateClientStatus
);

// CSV upload route for business owners to bulk add clients
router.post(
  "/upload-csv",
  isAuthenticated, // Only authenticated users (business owners)
  uploader.single("file"), // Accept a single file with field name 'file'
  clientController.uploadClientsCSV
);

module.exports = router;
