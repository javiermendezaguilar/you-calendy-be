const express = require("express");
const router = express.Router();
const {
  getAllNotifications,
  markAsAllRead,
} = require("../controllers/notificationController");
const { isAuthenticated } = require("../middleware/auth");

router.get("/", isAuthenticated, getAllNotifications);
router.patch("/mark-all-read", isAuthenticated, markAsAllRead);

module.exports = router;
