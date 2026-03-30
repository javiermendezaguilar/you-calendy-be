const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/auth");
const serviceController = require("../controllers/serviceController");

// Public routes
router.get("/", serviceController.getServices);
router.get("/categories", serviceController.getServiceCategories);
router.get("/:id", serviceController.getServiceById);

// Protected routes
router.put("/:id", isAuthenticated, serviceController.updateService);
router.delete("/:id", serviceController.deleteService);

module.exports = router;
