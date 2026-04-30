const express = require("express");
const router = express.Router();
const {
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  updatePassword,
  // updateProfile,
  getMe,
  getRolePermissions,
  socialAuth,
  // updateAdminProfile,
  getBarber,
  updateBarberStatus,
  getByID,
  deleteBarber,
  createSubadmin,
  getAllSubadmins,
  getSubadminById,
  updateSubadmin,
  deleteSubadmin,
  getProfileSettings,
  updateProfileSettings,
  updateNotificationSettings,
} = require("../controllers/authController");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const { validateRequest } = require("../middleware/validateRequest");
const { authInputSchemas } = require("../validation/authInputSchemas");
const {
  authRouterLimiter,
  authWriteLimiter,
} = require("../middleware/economicRateLimit");
const uploader = require("../utils/uploader");

// Auth routes
router.use(authRouterLimiter);
router
  .route("/register")
  .post(authWriteLimiter, validateRequest(authInputSchemas.register), register);
router
  .route("/login")
  .post(authWriteLimiter, validateRequest(authInputSchemas.login), login);
// Logout doesn't require authentication (works even with expired tokens)
router
  .route("/logout")
  .post(validateRequest(authInputSchemas.logout), logout);
router
  .route("/forgotPassword")
  .post(
    authWriteLimiter,
    validateRequest(authInputSchemas.forgotPassword),
    forgotPassword
  );
router
  .route("/resetPassword")
  .put(
    authWriteLimiter,
    validateRequest(authInputSchemas.resetPassword),
    resetPassword
  );
router
  .route("/updatePassword")
  .put(
    isAuthenticated,
    authWriteLimiter,
    validateRequest(authInputSchemas.updatePassword),
    updatePassword
  );
router.route("/me").get(isAuthenticated, getMe);
router.route("/role-permissions").get(isAuthenticated, getRolePermissions);
// router.route("/updateProfile").put(
//   isAuthenticated,
//   uploader.fields([
//     { name: "profileImage", maxCount: 1 },
//     { name: "fullImage", maxCount: 1 },
//   ]),
//   updateProfile
// );

// Profile settings routes
router
  .route("/profile-settings")
  .get(isAuthenticated, getProfileSettings)
  .put(
    isAuthenticated,
    uploader.fields([{ name: "profileImage", maxCount: 1 }]),
    updateProfileSettings
  );

router
  .route("/notification-settings")
  .patch(
    isAuthenticated,
    validateRequest(authInputSchemas.notificationSettings),
    updateNotificationSettings
  );

// router
//   .route("/updateAdminProfile")
//   .put(
//     isAuthenticated,
//     uploader.fields([{ name: "profileImage", maxCount: 1 }]),
//     updateAdminProfile
//   );

router
  .route("/socialAuth")
  .post(
    authWriteLimiter,
    validateRequest(authInputSchemas.socialAuth),
    socialAuth
  );

router.route("/barbers").get(isAuthenticated, getBarber);

router.patch(
  "/barbers/:id/status",
  isAuthenticated,
  isAdmin,
  validateRequest(authInputSchemas.updateBarberStatus),
  updateBarberStatus
);

router.get(
  "/barbers/:id",
  isAuthenticated,
  validateRequest(authInputSchemas.barberById),
  getByID
);

router.delete(
  "/barbers/:id",
  isAuthenticated,
  isAdmin,
  validateRequest(authInputSchemas.barberById),
  deleteBarber
);

router.post("/subadmins", isAuthenticated, isAdmin, createSubadmin);
router.get("/subadmins", isAuthenticated, isAdmin, getAllSubadmins);
router.get("/subadmins/:id", isAuthenticated, isAdmin, getSubadminById);
router.put("/subadmins/:id", isAuthenticated, isAdmin, updateSubadmin);
router.delete("/subadmins/:id", isAuthenticated, isAdmin, deleteSubadmin);

module.exports = router;
