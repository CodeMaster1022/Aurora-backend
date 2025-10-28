const express = require('express');
const router = express.Router();
const { getSpeakers, getSpeakerProfile } = require('../controllers/speakerController');

// Public routes (no authentication required)
router.get('/', getSpeakers);
router.get('/:id', getSpeakerProfile);

module.exports = router;

