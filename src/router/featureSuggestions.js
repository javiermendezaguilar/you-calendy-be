const express = require("express");
const router = express.Router();
const featureSuggestionController = require("../controllers/featureSuggestionController");
const { isAuthenticated } = require("../middleware/auth");
// You may want to add authentication middleware here, e.g., requireStaffAuth

// Create a new feature suggestion
router.post(
  "/",
  isAuthenticated,
  featureSuggestionController.createFeatureSuggestion
);
// Get all feature suggestions
router.get("/", featureSuggestionController.getAllFeatureSuggestions);
// Get a single feature suggestion by ID
router.get("/:id", featureSuggestionController.getFeatureSuggestionById);
// Update a feature suggestion
router.put(
  "/:id",
  /* requireStaffAuth, */ featureSuggestionController.updateFeatureSuggestion
);
// Delete a feature suggestion
router.delete(
  "/:id",
  /* requireStaffAuth, */ featureSuggestionController.deleteFeatureSuggestion
);

module.exports = router;
