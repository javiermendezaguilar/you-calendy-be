const express = require("express");
const router = express.Router();
const {
  createPromotion,
  getPromotions,
  getPromotionById,
  updatePromotion,
  deletePromotion,
  togglePromotionStatus,
  getActivePromotions,
  getPromotionStats,
} = require("../controllers/promotionController");
const { isAuthenticated } = require("../middleware/auth");

// Protected routes (require authentication)
router
  .route("/")
  .post(isAuthenticated, createPromotion)
  .get(isAuthenticated, getPromotions);

// Public route (no authentication required) - MUST be before /:id route
router.get("/active", getActivePromotions);

router.get("/stats", isAuthenticated, getPromotionStats);

router
  .route("/:id")
  .get(isAuthenticated, getPromotionById)
  .put(isAuthenticated, updatePromotion)
  .delete(isAuthenticated, deletePromotion);

router.patch("/:id/toggle", isAuthenticated, togglePromotionStatus);

module.exports = router;
