const express = require("express");
const router = express.Router();
const businessController = require("../controllers/businessController");

// Public barber profile route (no authentication required)
router.get("/profile/:linkToken", businessController.getBarberProfileByLink);

module.exports = router;
