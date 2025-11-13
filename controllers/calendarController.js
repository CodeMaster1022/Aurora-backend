const User = require('../models/User');
const { 
  getAuthUrl, 
  getTokensFromCode, 
  createOAuthClient, 
  refreshAccessToken 
} = require('../utils/googleCalendar');

// @desc    Initiate Google Calendar OAuth connection
// @route   GET /api/speaker/calendar/auth-url
// @access  Private (Speaker)
const getCalendarAuthUrl = async (req, res) => {
  try {
    const authUrl = getAuthUrl();
    res.json({
      success: true,
      data: { authUrl }
    });
  } catch (error) {
    console.error('Get calendar auth URL error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Handle Google Calendar OAuth callback
// @route   GET /api/speaker/calendar/callback
// @access  Public
const handleCalendarCallback = async (req, res) => {
  const { code, state } = req.query;
  console.log("=====================>>>>>>>>")
  console.log(code, state)
  try {
    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Authorization code not provided'
      });
    }

    const userId = state;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID not provided in state'
      });
    }

    const tokens = await getTokensFromCode(code);
    
    const user = await User.findByIdAndUpdate(
      userId,
      {
        'googleCalendar.accessToken': tokens.accessToken,
        'googleCalendar.refreshToken': tokens.refreshToken,
        'googleCalendar.expiresAt': tokens.expiryDate,
        'googleCalendar.connected': true
      },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/speakers/profile?calendar=connected`);
  } catch (error) {
    console.error('Calendar callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/speakers/profile?calendar=error`);
  }
};

// @desc    Check if speaker has connected Google Calendar
// @route   GET /api/speaker/calendar/status
// @access  Private (Speaker)
const getCalendarStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('googleCalendar');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        connected: user.googleCalendar?.connected || false,
        expiresAt: user.googleCalendar?.expiresAt || null
      }
    });
  } catch (error) {
    console.error('Get calendar status error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Disconnect Google Calendar
// @route   POST /api/speaker/calendar/disconnect
// @access  Private (Speaker)
const disconnectCalendar = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findByIdAndUpdate(
      userId,
      {
        'googleCalendar.accessToken': null,
        'googleCalendar.refreshToken': null,
        'googleCalendar.expiresAt': null,
        'googleCalendar.connected': false
      },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Google Calendar disconnected successfully',
      data: { user }
    });
  } catch (error) {
    console.error('Disconnect calendar error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

module.exports = {
  getCalendarAuthUrl,
  handleCalendarCallback,
  getCalendarStatus,
  disconnectCalendar
};

