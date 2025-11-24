const express = require('express');
const router = express.Router();
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  streamNotifications
} = require('../controllers/notificationController');
const { authenticateToken } = require('../middleware/auth');

// SSE stream for real-time notifications (handles auth manually for query param support)
// This route must be BEFORE the authenticateToken middleware since EventSource can't send headers
router.get('/stream', (req, res, next) => {
  // Allow token from query parameter for EventSource compatibility
  if (req.query.token) {
    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    
    try {
      const decoded = jwt.verify(req.query.token, process.env.JWT_SECRET);
      
      // Get user from database to match authenticateToken behavior
      User.findById(decoded.userId)
        .then(user => {
          if (!user) {
            console.log('SSE: User not found for userId:', decoded.userId);
            return res.status(401).json({
              success: false,
              message: 'User not found'
            });
          }
          
          if (!user.isActive) {
            console.log('SSE: User account deactivated for userId:', decoded.userId);
            return res.status(401).json({
              success: false,
              message: 'User account is deactivated'
            });
          }
          
          console.log('SSE: Authentication successful for user:', user._id);
          req.user = user;
          return streamNotifications(req, res, next);
        })
        .catch(error => {
          console.error('Error finding user for SSE:', error);
          return res.status(401).json({
            success: false,
            message: 'Authentication failed'
          });
        });
    } catch (error) {
      console.error('SSE token verification error:', error.message);
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
  } else {
    // If no token in query, try header authentication
    authenticateToken(req, res, () => streamNotifications(req, res, next));
  }
});

// All other notification routes require authentication
router.use(authenticateToken);

// Get all notifications
router.get('/', getNotifications);

// Get unread count
router.get('/unread-count', getUnreadCount);

// Mark notification as read
router.put('/:id/read', markAsRead);

// Mark all notifications as read
router.put('/read-all', markAllAsRead);

// Delete notification
router.delete('/:id', deleteNotification);

module.exports = router;

