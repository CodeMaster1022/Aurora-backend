const express = require('express');
const router = express.Router();
const { googleAuth, googleAuthSpeaker } = require('../controllers/googleAuthController');

// @route   POST /api/auth/google
// @desc    Google OAuth Sign-in/Sign-up for learners
// @access  Public
router.post('/google', googleAuth);

// @route   POST /api/auth/google/speaker
// @desc    Google OAuth Sign-in/Sign-up for speakers
// @access  Public
router.post('/google/speaker', googleAuthSpeaker);

module.exports = router;

