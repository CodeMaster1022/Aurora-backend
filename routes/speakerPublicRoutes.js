const express = require('express');
const router = express.Router();
const { getSpeakers, getSpeakerProfile, getTopics } = require('../controllers/speakerController');

// Public routes (no authentication required)
router.get('/', getSpeakers);
router.get('/topics', getTopics);
router.get('/:id', getSpeakerProfile);

module.exports = router;

