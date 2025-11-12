const User = require('../models/User');
const {
  getAuthUrl,
  getTokensFromCode,
  createOAuthClient,
  refreshAccessToken,
  encodeOAuthState,
  decodeOAuthState
} = require('../utils/googleCalendar');

// @desc    Initiate Google Calendar OAuth connection
// @route   GET /api/speaker/calendar/auth-url
// @access  Private (Speaker)
const getCalendarAuthUrl = async (req, res) => {
  try {
    const userId = req.user?._id?.toString();
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Authenticated user not found'
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const statePayload = encodeOAuthState({
      userId,
      redirectTo: `${frontendUrl}/speakers/dashboard`,
      timestamp: Date.now()
    });

    if (!statePayload) {
      return res.status(500).json({
        success: false,
        message: 'Failed to initiate OAuth request'
      });
    }

    const authUrl = getAuthUrl(statePayload);
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
  const { code, state, error: oauthError, error_description: errorDescription } = req.query;
  console.log('Google Calendar callback received:', { codePresent: !!code, statePresent: !!state, oauthError, errorDescription });
  try {
    const statePayload = decodeOAuthState(state);
    
    if (!statePayload?.userId) {
      console.error('Invalid or missing OAuth state payload');
      return res.redirect(
        `${process.env.FRONTEND_URL || 'http://localhost:3000'}/speakers/profile?calendar=error&reason=invalid_state`
      );
    }

    const frontendRedirect = statePayload.redirectTo || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/speakers/dashboard`;

    if (oauthError) {
      console.error('Google returned an OAuth error:', oauthError, errorDescription);
      return res.redirect(
        `${frontendRedirect}?calendar=error&reason=${encodeURIComponent(oauthError)}`
      );
    }

    if (!code) {
      console.error('Authorization code missing in callback');
      return res.redirect(`${frontendRedirect}?calendar=error&reason=missing_code`);
    }

    const userId = statePayload.userId;
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
        message: 'User not found',
        redirect: `${frontendRedirect}?calendar=error`
      });
    }

    res.redirect(`${frontendRedirect}?calendar=connected`);
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

