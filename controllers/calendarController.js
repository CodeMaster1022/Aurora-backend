const User = require('../models/User');
const { 
  getAuthUrl, 
  getTokensFromCode, 
  createOAuthClient, 
  refreshAccessToken,
  getValidOAuthClient
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

    // If calendar is connected, verify token is valid and refresh if needed
    if (user.googleCalendar?.connected) {
      try {
        // Create callback function to update user in database
        const updateUserCallback = async (userId, updateData) => {
          await User.findByIdAndUpdate(userId, { $set: updateData });
        };

        // Get a valid OAuth client (will refresh token if expired)
        await getValidOAuthClient(user, updateUserCallback);

        // Reload user to get updated token info
        const updatedUser = await User.findById(userId).select('googleCalendar');
        
        return res.json({
          success: true,
          data: {
            connected: updatedUser.googleCalendar?.connected || false,
            expiresAt: updatedUser.googleCalendar?.expiresAt || null,
            tokenValid: true
          }
        });
      } catch (tokenError) {
        console.error('Token validation error:', tokenError);
        // If token refresh fails, the token might be invalid
        // Mark as disconnected so user can reconnect
        if (tokenError.message.includes('invalid') || tokenError.message.includes('revoked')) {
          await User.findByIdAndUpdate(userId, {
            'googleCalendar.connected': false
          });
          
          return res.json({
            success: true,
            data: {
              connected: false,
              expiresAt: null,
              tokenValid: false,
              message: 'Google Calendar token is invalid. Please reconnect your calendar.'
            }
          });
        }
        
        // For other errors, still return status but indicate token might be invalid
        return res.json({
          success: true,
          data: {
            connected: user.googleCalendar?.connected || false,
            expiresAt: user.googleCalendar?.expiresAt || null,
            tokenValid: false,
            message: 'Unable to verify token. Please try reconnecting your calendar if you experience issues.'
          }
        });
      }
    }

    // Calendar is not connected
    res.json({
      success: true,
      data: {
        connected: false,
        expiresAt: null,
        tokenValid: false
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

