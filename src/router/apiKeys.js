const express = require("express");
const router = express.Router();
const { updateApiKeys, getApiKeys } = require("../controllers/apiKeyController");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const { validateRequest } = require("../middleware/validateRequest");
const { adminInputSchemas } = require("../validation/adminInputSchemas");

// All API key routes require admin authentication
router.use(isAuthenticated, isAdmin);

// API keys routes
router.get("/", getApiKeys);
router.put("/", validateRequest(adminInputSchemas.apiKeys), updateApiKeys);

module.exports = router;
