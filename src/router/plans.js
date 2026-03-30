const express = require("express");
const router = express.Router();
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const planController = require("../controllers/planController");

// Public routes
router.get("/", planController.getPlans);
router.get("/:id", planController.getPlanById);

// Protected routes (Admin only)
router.post("/", isAuthenticated, isAdmin, planController.createPlan);
router.put("/:id", isAuthenticated, isAdmin, planController.updatePlan);
router.delete("/:id", isAuthenticated, isAdmin, planController.deletePlan);
router.get("/admin/all", isAuthenticated, isAdmin, planController.getAllPlans);

module.exports = router;
