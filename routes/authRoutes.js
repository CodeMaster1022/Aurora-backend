const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  registerUser,
  registerSpeaker,
  loginUser,
  getCurrentUser,
  logoutUser,
  acceptTerms,
  forgotPassword,
  resetPassword,
  verifyOTP,
  resendOTP
} = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

// Configure multer for file uploads using memory storage (for Cloudinary)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Accept images only
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Not an image! Please upload an image.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: fileFilter
});

// Public routes
router.post('/signup', registerUser);
router.post('/speaker/signup', upload.single('avatar'), registerSpeaker);
router.post('/login', loginUser);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);

// Protected routes
router.get('/me', authenticateToken, getCurrentUser);
router.post('/logout', authenticateToken, logoutUser);
router.post('/accept-terms', authenticateToken, acceptTerms);

module.exports = router;
