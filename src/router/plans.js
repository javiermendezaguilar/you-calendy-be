const express = require("express");
const router = express.Router();
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const { validateRequest } = require("../middleware/validateRequest");
const { adminInputSchemas } = require("../validation/adminInputSchemas");
const planController = require("../controllers/planController");

// Public routes
router.get("/", planController.getPlans);
router.get(
  "/admin/all",
  isAuthenticated,
  isAdmin,
  planController.getAllPlans
);
router.get(
  "/:id",
  validateRequest(adminInputSchemas.planById),
  planController.getPlanById
);

// Protected routes (Admin only)
router.post(
  "/",
  isAuthenticated,
  isAdmin,
  validateRequest(adminInputSchemas.createPlan),
  planController.createPlan
);
router.put(
  "/:id",
  isAuthenticated,
  isAdmin,
  validateRequest(adminInputSchemas.updatePlan),
  planController.updatePlan
);
router.delete(
  "/:id",
  isAuthenticated,
  isAdmin,
  validateRequest(adminInputSchemas.deletePlan),
  planController.deletePlan
);

module.exports = router;
