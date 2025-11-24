const Notification = require('../models/Notification');
const User = require('../models/User');

// Store active SSE connections per user
const sseConnections = new Map();

// @desc    Get all notifications for user
// @route   GET /api/notifications
// @access  Private
const getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit = 50, skip = 0, unreadOnly = false } = req.query;

    const query = { user: userId };
    if (unreadOnly === 'true') {
      query.read = false;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const unreadCount = await Notification.countDocuments({
      user: userId,
      read: false
    });

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount,
        total: notifications.length
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Mark notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
const markAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const notificationId = req.params.id;

    const notification = await Notification.findOneAndUpdate(
      {
        _id: notificationId,
        user: userId
      },
      {
        read: true,
        readAt: new Date()
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read',
      data: { notification }
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/read-all
// @access  Private
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await Notification.updateMany(
      {
        user: userId,
        read: false
      },
      {
        read: true,
        readAt: new Date()
      }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read',
      data: { updatedCount: result.modifiedCount }
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Delete notification
// @route   DELETE /api/notifications/:id
// @access  Private
const deleteNotification = async (req, res) => {
  try {
    const userId = req.user._id;
    const notificationId = req.params.id;

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      user: userId
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted',
      data: { notification }
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get unread count
// @route   GET /api/notifications/unread-count
// @access  Private
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;

    const unreadCount = await Notification.countDocuments({
      user: userId,
      read: false
    });

    res.json({
      success: true,
      data: { unreadCount }
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Server-Sent Events endpoint for real-time notifications
// @route   GET /api/notifications/stream
// @access  Private
const streamNotifications = async (req, res) => {
  try {
    const userId = req.user._id.toString();

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Send initial connection message
    const connectionMessage = { type: 'connected', message: 'Connected to notification stream' };
    res.write(`data: ${JSON.stringify(connectionMessage)}\n\n`);
    console.log(`Sent connection message to user ${userId}`);

    // Store connection
    const connectionId = `${userId}-${Date.now()}`;
    sseConnections.set(connectionId, {
      userId: userId.toString(), // Store as string for consistent comparison
      res,
      lastPing: Date.now()
    });
    
    console.log(`SSE connection established for user ${userId} (connectionId: ${connectionId})`);
    console.log(`Total active connections: ${sseConnections.size}`);

    // Send ping every 30 seconds to keep connection alive
    const pingInterval = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
        
        // Update last ping time
        const conn = sseConnections.get(connectionId);
        if (conn) {
          conn.lastPing = Date.now();
        }
      } catch (error) {
        clearInterval(pingInterval);
        sseConnections.delete(connectionId);
      }
    }, 30000);

    // Handle client disconnect
    req.on('close', () => {
      clearInterval(pingInterval);
      sseConnections.delete(connectionId);
      console.log(`SSE connection closed for user ${userId}`);
    });

    // Clean up on error
    req.on('error', (error) => {
      console.error('SSE connection error:', error);
      clearInterval(pingInterval);
      sseConnections.delete(connectionId);
    });
  } catch (error) {
    console.error('SSE stream error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// Helper function to send notification to SSE clients
const sendNotificationToSSE = (userId, notification) => {
  const notificationData = {
    type: 'notification',
    data: notification
  };

  const userIdStr = userId.toString();
  console.log(`Attempting to send notification to user: ${userIdStr}`);
  console.log(`Active SSE connections: ${sseConnections.size}`);

  let sentCount = 0;
  // Send to all connections for this user
  sseConnections.forEach((conn, connectionId) => {
    const connUserIdStr = conn.userId.toString();
    console.log(`Checking connection ${connectionId}: user ${connUserIdStr} === ${userIdStr}? ${connUserIdStr === userIdStr}`);
    
    if (connUserIdStr === userIdStr) {
      try {
        conn.res.write(`data: ${JSON.stringify(notificationData)}\n\n`);
        sentCount++;
        console.log(`✓ Notification sent to connection ${connectionId}`);
      } catch (error) {
        console.error(`Error sending SSE to connection ${connectionId}:`, error);
        sseConnections.delete(connectionId);
      }
    }
  });

  if (sentCount === 0) {
    console.log(`⚠ No active SSE connections found for user ${userIdStr}`);
  } else {
    console.log(`✓ Sent notification to ${sentCount} connection(s) for user ${userIdStr}`);
  }
};

// Helper function to send unread count update
const sendUnreadCountUpdate = async (userId) => {
  try {
    const unreadCount = await Notification.countDocuments({
      user: userId,
      read: false
    });

    const countData = {
      type: 'unread_count',
      data: { unreadCount }
    };

    const userIdStr = userId.toString();
    let sentCount = 0;
    
    sseConnections.forEach((conn, connectionId) => {
      if (conn.userId === userIdStr) {
        try {
          conn.res.write(`data: ${JSON.stringify(countData)}\n\n`);
          sentCount++;
        } catch (error) {
          console.error(`Error sending unread count to connection ${connectionId}:`, error);
          sseConnections.delete(connectionId);
        }
      }
    });
    
    if (sentCount > 0) {
      console.log(`✓ Sent unread count (${unreadCount}) to ${sentCount} connection(s) for user ${userIdStr}`);
    }
  } catch (error) {
    console.error('Error getting unread count for SSE:', error);
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  streamNotifications,
  sendNotificationToSSE,
  sendUnreadCountUpdate
};

