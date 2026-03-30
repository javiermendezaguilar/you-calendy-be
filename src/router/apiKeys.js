const express = require("express");
const router = express.Router();
const { updateApiKeys, getApiKeys } = require("../controllers/apiKeyController");
const { isAuthenticated } = require("../middleware/auth");

// All API key routes require admin authentication
router.use(isAuthenticated);

// API keys routes
router.get("/", getApiKeys);
router.put("/", updateApiKeys);

module.exports = router;
