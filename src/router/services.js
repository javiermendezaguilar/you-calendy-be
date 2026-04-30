const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/auth");
const { validateRequest } = require("../middleware/validateRequest");
const serviceController = require("../controllers/serviceController");
const { serviceInputSchemas } = require("../validation/serviceInputSchemas");

// Public routes
router.get(
  "/",
  validateRequest(serviceInputSchemas.listServices),
  serviceController.getServices
);
router.get(
  "/categories",
  validateRequest(serviceInputSchemas.serviceCategories),
  serviceController.getServiceCategories
);
router.get(
  "/:id",
  validateRequest(serviceInputSchemas.serviceById),
  serviceController.getServiceById
);

// Protected routes
router.put(
  "/:id",
  isAuthenticated,
  validateRequest(serviceInputSchemas.updateLegacyService),
  serviceController.updateService
);
router.delete(
  "/:id",
  isAuthenticated,
  validateRequest(serviceInputSchemas.deleteLegacyService),
  serviceController.deleteService
);

module.exports = router;
