const express = require("express");
const router = express.Router();
const translateController = require("../controllers/translateController");

// POST /api/translate
router.post("/", translateController.translate);

// POST /api/translate/batch
router.post("/batch", translateController.translateBatchTexts);

module.exports = router;
