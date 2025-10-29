const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { uploadImage } = require('../utils/cloudinary');

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
    availability: user.availability
  };
};

// @desc    Register a new user
// @route   POST /api/auth/signup
// @access  Public
const registerUser = async (req, res) => {
  try {
    const { firstname, lastname, email, password, role } = req.body;

    // Validate required fields
    if (!firstname || !lastname) {
      return res.status(400).json({
        success: false,
        message: 'First name and last name are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create user
    const userData = {
      firstname,
      lastname,
      email,
      password,
      role: role || 'learner'
    };

    const user = await User.create(userData);

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: formatUserResponse(user),
        token
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during registration'
    });
  }
};

// @desc    Register a new speaker
// @route   POST /api/auth/speaker/signup
// @access  Public
const registerSpeaker = async (req, res) => {
  try {
    const { firstName, lastName, email, password, interests, meetingPreference } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Handle avatar upload if present
    let avatarPath = null;
    if (req.file) {
      try {
        const result = await uploadImage(req.file.buffer, 'avatars');
        avatarPath = result.secure_url;
      } catch (uploadError) {
        console.error('Avatar upload error:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload avatar. Please try again.'
        });
      }
    }

    // Parse interests if it's a string
    let interestsArray = [];
    if (interests) {
      try {
        interestsArray = typeof interests === 'string' ? JSON.parse(interests) : interests;
      } catch (e) {
        interestsArray = Array.isArray(interests) ? interests : [interests];
      }
    }

    // Create speaker user
    const user = await User.create({
      firstname: firstName,
      lastname: lastName,
      email,
      password,
      role: 'speaker',
      interests: interestsArray,
      meetingPreference,
      avatar: avatarPath,
      status: 'review' // Speakers need review
    });

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Speaker registered successfully',
      data: {
        user: formatUserResponse(user),
        token
      }
    });
  } catch (error) {
    console.error('Speaker registration error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during speaker registration'
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Find user
    const user = await User.findOne({ email }).select('+password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated'
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: formatUserResponse(user),
        token
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during login'
    });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
const getCurrentUser = async (req, res) => {
  try {
    const user = req.user;

    res.json({
      success: true,
      message: 'User fetched successfully',
      data: {
        user: formatUserResponse(user),
        token: req.headers.authorization?.substring(7) // Return existing token
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logoutUser = async (req, res) => {
  try {
    // In a stateless JWT system, we just return success
    // Token is removed on client side
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during logout'
    });
  }
};

module.exports = {
  registerUser,
  registerSpeaker,
  loginUser,
  getCurrentUser,
  logoutUser
};
