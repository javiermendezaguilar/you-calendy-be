const express = require("express");
const router = express.Router();
const supportController = require("../controllers/supportController");
const { isAuthenticated, isAdmin } = require("../middleware/auth");

// Create a new support ticket
router.post("/", isAuthenticated, supportController.createSupport);

// Get all support tickets (with filtering)
router.get("/", isAuthenticated, supportController.getAllSupport);

// Get support tickets for the current barber
router.get(
  "/my-tickets",
  isAuthenticated,
  supportController.getMySupportTickets
);

// Get support statistics (Admin only)
router.get(
  "/stats",
  isAuthenticated,
  isAdmin,
  supportController.getSupportStats
);

// Get a single support ticket by ID
router.get("/:id", isAuthenticated, supportController.getSupportById);

// Update a support ticket
router.put("/:id", isAuthenticated, supportController.updateSupport);

// Update support ticket priority (Admin only)
router.put(
  "/:id/priority",
  isAuthenticated,
  isAdmin,
  supportController.updateSupportPriority
);

// Update support ticket status (Admin only)
router.put(
  "/:id/status",
  isAuthenticated,
  isAdmin,
  supportController.updateSupportStatus
);

// Delete a support ticket
router.delete("/:id", isAuthenticated, supportController.deleteSupport);

module.exports = router;
