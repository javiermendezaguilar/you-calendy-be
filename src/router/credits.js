const express = require("express");
const router = express.Router();
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const { creditCheckoutWriteLimiter } = require("../middleware/economicRateLimit");
const {
  createCreditProduct,
  listCreditProducts,
  createCheckoutSession,
  updateCreditProduct,
  deleteCreditProduct,
  getBusinessCredits,
} = require("../controllers/creditsController");

// Public listing for barbers
router.get("/products", /* #swagger.tags = ['Credits'] */ listCreditProducts);

// Admin creates/updates products
router.post(
  "/products",
  isAuthenticated,
  isAdmin,
  /* #swagger.tags = ['Credits'] */ createCreditProduct
);
router.put(
  "/products/:id",
  isAuthenticated,
  isAdmin,
  /* #swagger.tags = ['Credits'] */ updateCreditProduct
);
router.delete(
  "/products/:id",
  isAuthenticated,
  isAdmin,
  /* #swagger.tags = ['Credits'] */ deleteCreditProduct
);

// Barber creates checkout session
router.post(
  "/checkout",
  isAuthenticated,
  creditCheckoutWriteLimiter,
  /* #swagger.tags = ['Credits'] */ createCheckoutSession
);

// Barber gets their current credits
router.get(
  "/my-credits",
  isAuthenticated,
  /* #swagger.tags = ['Credits'] */ getBusinessCredits
);

module.exports = router;
