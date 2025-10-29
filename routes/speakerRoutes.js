const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken, checkSpeaker } = require('../middleware/auth');
const {
  getDashboard,
  updateProfile,
  updateAvailability,
  uploadAvatar,
  rateLearner,
  getGiftSong,
  cancelSession
} = require('../controllers/speakerController');
const {
  getCalendarAuthUrl,
  getCalendarStatus,
  disconnectCalendar
} = require('../controllers/calendarController');

// Multer configuration for avatar upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// All routes require authentication and speaker role
router.use(authenticateToken);
router.use(checkSpeaker);

// Dashboard route
router.get('/dashboard', getDashboard);

// Profile routes
router.put('/profile', updateProfile);
router.put('/availability', updateAvailability);
router.post('/avatar', upload.single('avatar'), uploadAvatar);

// Session rating routes
router.post('/sessions/:id/review', rateLearner);
router.put('/sessions/:id/cancel', cancelSession);
router.get('/gift-song', getGiftSong);

// Google Calendar routes
router.get('/calendar/auth-url', getCalendarAuthUrl);
router.get('/calendar/status', getCalendarStatus);
router.post('/calendar/disconnect', disconnectCalendar);

module.exports = router;

