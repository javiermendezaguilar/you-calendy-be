const express = require("express");
const router = express.Router();
const {
  createFlashSale,
  getFlashSales,
  getFlashSaleById,
  updateFlashSale,
  deleteFlashSale,
  toggleFlashSaleStatus,
  getActiveFlashSales,
  getFlashSaleStats,
} = require("../controllers/flashSaleController");
const { isAuthenticated } = require("../middleware/auth");

// Protected routes (require authentication)
router
  .route("/")
  .post(isAuthenticated, createFlashSale)
  .get(isAuthenticated, getFlashSales);

// Public route (no authentication required) - MUST be before /:id route
router.get("/active", getActiveFlashSales);

router.get("/stats", isAuthenticated, getFlashSaleStats);

router
  .route("/:id")
  .get(isAuthenticated, getFlashSaleById)
  .put(isAuthenticated, updateFlashSale)
  .delete(isAuthenticated, deleteFlashSale);

router.patch("/:id/toggle", isAuthenticated, toggleFlashSaleStatus);

module.exports = router;
