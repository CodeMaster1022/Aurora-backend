const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const {
  getDashboard,
  getSession,
  rateSession,
  updateProfile,
  uploadAvatar,
  bookSession
} = require('../controllers/learnerController');

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

// All routes require authentication
router.use(authenticateToken);

// Dashboard routes
router.get('/dashboard', getDashboard);

// Session routes
router.post('/book-session', bookSession);
router.get('/sessions/:id', getSession);
router.post('/sessions/:id/review', rateSession);

// Profile routes
router.put('/profile', updateProfile);
router.post('/avatar', upload.single('avatar'), uploadAvatar);

module.exports = router;

