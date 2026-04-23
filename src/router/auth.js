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
const rateLimit = require("express-rate-limit");
const uploader = require("../utils/uploader");

const authRouterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication requests, please try again later.",
  },
});

const authWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later.",
  },
});

// Auth routes
router.use(authRouterLimiter);
router.route("/register").post(authWriteLimiter, register);
router.route("/login").post(authWriteLimiter, login);
// Logout doesn't require authentication (works even with expired tokens)
router.route("/logout").post(logout);
router.route("/forgotPassword").post(authWriteLimiter, forgotPassword);
router.route("/resetPassword").put(authWriteLimiter, resetPassword);
router.route("/updatePassword").put(isAuthenticated, updatePassword);
router.route("/me").get(isAuthenticated, getMe);
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
  .patch(isAuthenticated, updateNotificationSettings);

// router
//   .route("/updateAdminProfile")
//   .put(
//     isAuthenticated,
//     uploader.fields([{ name: "profileImage", maxCount: 1 }]),
//     updateAdminProfile
//   );

router.route("/socialAuth").post(authWriteLimiter, socialAuth);

router.route("/barbers").get(isAuthenticated, getBarber);

router.patch(
  "/barbers/:id/status",
  isAuthenticated,
  isAdmin,
  updateBarberStatus
);

router.get("/barbers/:id", isAuthenticated, getByID);

router.delete("/barbers/:id", isAuthenticated, isAdmin, deleteBarber);

router.post("/subadmins", isAuthenticated, isAdmin, createSubadmin);
router.get("/subadmins", isAuthenticated, isAdmin, getAllSubadmins);
router.get("/subadmins/:id", isAuthenticated, isAdmin, getSubadminById);
router.put("/subadmins/:id", isAuthenticated, isAdmin, updateSubadmin);
router.delete("/subadmins/:id", isAuthenticated, isAdmin, deleteSubadmin);

module.exports = router;
