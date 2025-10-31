const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });
};

// Helper function to format user response
const formatUserResponse = (user) => {
  return {
    _id: user._id,
    firstname: user.firstname,
    lastname: user.lastname,
    email: user.email,
    role: user.role,
    status: user.status,
    lastLogin: user.lastLogin,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    interests: user.interests,
    meetingPreference: user.meetingPreference,
    avatar: user.avatar,
    bio: user.bio,
    age: user.age,
    cost: user.cost,
    availability: user.availability,
    termsAccepted: user.termsAccepted,
    termsAcceptedAt: user.termsAcceptedAt,
    privacyAccepted: user.privacyAccepted,
    privacyAcceptedAt: user.privacyAcceptedAt,
    googleId: user.googleId
  };
};

// @desc    Google OAuth Sign-in/Sign-up
// @route   POST /api/auth/google
// @access  Public
const googleAuth = async (req, res) => {
  try {
    const { credential, role } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Google credential is required'
      });
    }

    // Verify Google token
    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch (error) {
      console.error('Google token verification error:', error);
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token'
      });
    }

    const payload = ticket.getPayload();
    const { sub: googleId, email, given_name, family_name, picture } = payload;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email not provided by Google'
      });
    }

    // Check if user exists with this email
    let user = await User.findOne({ email });

    if (user) {
      // User exists - update Google ID if not set
      if (!user.googleId) {
        user.googleId = googleId;
        user.avatar = user.avatar || picture;
        await user.save();
      }

      // Check if user is active
      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Your account has been deactivated'
        });
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Generate token
      const token = generateToken(user._id);

      return res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: formatUserResponse(user),
          token
        }
      });
    } else {
      // User doesn't exist - create new user
      const newUser = await User.create({
        firstname: given_name || 'User',
        lastname: family_name || '',
        email,
        googleId,
        avatar: picture,
        role: role || 'learner', // Default to learner, can be specified
        password: Math.random().toString(36).slice(-8), // Random password for Google users
        termsAccepted: true,
        termsAcceptedAt: new Date(),
        privacyAccepted: true,
        privacyAcceptedAt: new Date(),
        isActive: true,
        lastLogin: new Date()
      });

      // Generate token
      const token = generateToken(newUser._id);

      return res.status(201).json({
        success: true,
        message: 'Account created successfully',
        data: {
          user: formatUserResponse(newUser),
          token
        }
      });
    }
  } catch (error) {
    console.error('Google authentication error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during Google authentication'
    });
  }
};

// @desc    Google OAuth Sign-up for Speaker
// @route   POST /api/auth/google/speaker
// @access  Public
const googleAuthSpeaker = async (req, res) => {
  try {
    const { credential, interests, meetingPreference, age, cost } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Google credential is required'
      });
    }

    // Verify Google token
    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch (error) {
      console.error('Google token verification error:', error);
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token'
      });
    }

    const payload = ticket.getPayload();
    const { sub: googleId, email, given_name, family_name, picture } = payload;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email not provided by Google'
      });
    }

    // Check if user exists with this email
    let user = await User.findOne({ email });

    if (user) {
      // User exists - check if already a speaker
      if (user.role === 'speaker') {
        // Already a speaker, just login
        if (!user.googleId) {
          user.googleId = googleId;
          await user.save();
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        const token = generateToken(user._id);

        return res.json({
          success: true,
          message: 'Login successful',
          data: {
            user: formatUserResponse(user),
            token
          }
        });
      } else {
        // User exists but not a speaker
        return res.status(400).json({
          success: false,
          message: 'An account with this email already exists as a learner. Please use the regular sign-in.'
        });
      }
    } else {
      // Parse interests if provided
      let interestsArray = [];
      if (interests) {
        try {
          interestsArray = typeof interests === 'string' ? JSON.parse(interests) : interests;
        } catch (e) {
          interestsArray = Array.isArray(interests) ? interests : [interests];
        }
      }

      // Create new speaker user
      const newUser = await User.create({
        firstname: given_name || 'Speaker',
        lastname: family_name || '',
        email,
        googleId,
        avatar: picture,
        role: 'speaker',
        interests: interestsArray,
        meetingPreference: meetingPreference || 'video',
        age: age || undefined,
        cost: cost || undefined,
        password: Math.random().toString(36).slice(-8), // Random password for Google users
        status: 'success',
        termsAccepted: true,
        termsAcceptedAt: new Date(),
        privacyAccepted: true,
        privacyAcceptedAt: new Date(),
        isActive: true,
        lastLogin: new Date()
      });

      // Generate token
      const token = generateToken(newUser._id);

      return res.status(201).json({
        success: true,
        message: 'Speaker account created successfully',
        data: {
          user: formatUserResponse(newUser),
          token
        }
      });
    }
  } catch (error) {
    console.error('Google speaker authentication error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during Google speaker authentication'
    });
  }
};

module.exports = {
  googleAuth,
  googleAuthSpeaker
};

