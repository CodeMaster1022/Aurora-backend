const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { uploadImage } = require('../utils/cloudinary');
const { sendPasswordResetEmail, sendOTPEmail } = require('../utils/email');

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
    location: user.location,
    age: user.age,
    cost: user.cost,
    availability: user.availability,
    termsAccepted: user.termsAccepted,
    termsAcceptedAt: user.termsAcceptedAt,
    privacyAccepted: user.privacyAccepted,
    privacyAcceptedAt: user.privacyAcceptedAt
  };
};

// @desc    Register a new user
// @route   POST /api/auth/signup
// @access  Public
const registerUser = async (req, res) => {
  try {
    const { firstname, lastname, email, password, role, termsAccepted, privacyAccepted } = req.body;

    // Validate required fields
    if (!firstname || !lastname) {
      return res.status(400).json({
        success: false,
        message: 'First name and last name are required'
      });
    }

    // Validate terms and privacy acceptance
    if (!termsAccepted || !privacyAccepted) {
      return res.status(400).json({
        success: false,
        message: 'You must accept the Terms and Conditions and Privacy Policy to continue'
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
      role: role || 'learner',
      termsAccepted: true,
      termsAcceptedAt: new Date(),
      privacyAccepted: true,
      privacyAcceptedAt: new Date()
    };

    const user = await User.create(userData);

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP to user
    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    // Send OTP email
    try {
      await sendOTPEmail(user.email, otp, user.firstname);
    } catch (emailError) {
      console.error('Error sending OTP email:', emailError);
      // Don't fail registration if email fails, but log it
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email with the OTP sent to your email address.',
      data: {
        user: formatUserResponse(user),
        requiresVerification: true
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
    const {
      firstName,
      lastName,
      email,
      password,
      interests,
      meetingPreference,
      age,
      cost,
      bio,
      location,
      termsAccepted,
      privacyAccepted
    } = req.body;

    // Validate terms and privacy acceptance
    if (!termsAccepted || !privacyAccepted) {
      return res.status(400).json({
        success: false,
        message: 'You must accept the Terms and Conditions and Privacy Policy to continue'
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

    // Parse availability if it's a string (from FormData)
    let availabilityArray = [];
    const availability = req.body.availability;
    if (availability) {
      try {
        availabilityArray = typeof availability === 'string' ? JSON.parse(availability) : availability;
      } catch (e) {
        availabilityArray = Array.isArray(availability) ? availability : [];
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
      location: location || undefined,
      bio: bio || undefined,
      avatar: avatarPath,
      age: age || undefined,
      cost: cost || undefined,
      availability: availabilityArray.length > 0 ? availabilityArray : undefined,
      status: 'success', // Speakers need review
      termsAccepted: true,
      termsAcceptedAt: new Date(),
      privacyAccepted: true,
      privacyAcceptedAt: new Date()
    });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP to user
    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    // Send OTP email
    try {
      await sendOTPEmail(user.email, otp, user.firstname);
    } catch (emailError) {
      console.error('Error sending OTP email:', emailError);
      // Don't fail registration if email fails, but log it
    }

    res.status(201).json({
      success: true,
      message: 'Speaker registered successfully. Please verify your email with the OTP sent to your email address.',
      data: {
        user: formatUserResponse(user),
        requiresVerification: true
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

// @desc    Accept terms and privacy policy
// @route   POST /api/auth/accept-terms
// @access  Private
const acceptTerms = async (req, res) => {
  try {
    const user = req.user;
    
    user.termsAccepted = true;
    user.termsAcceptedAt = new Date();
    user.privacyAccepted = true;
    user.privacyAcceptedAt = new Date();
    
    await user.save();

    res.json({
      success: true,
      message: 'Terms and Privacy Policy accepted successfully',
      data: {
        user: formatUserResponse(user)
      }
    });
  } catch (error) {
    console.error('Accept terms error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during terms acceptance'
    });
  }
};

// @desc    Forgot password - send reset email
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email address'
      });
    }

    // Find user
    const user = await User.findOne({ email });
    
    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Save reset token to user
    user.resetToken = resetToken;
    user.resetTokenExpiry = resetTokenExpiry;
    await user.save();

    // Create reset URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    // Send email
    try {
      await sendPasswordResetEmail(email, resetToken, resetUrl);
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      // Clear the reset token if email fails
      user.resetToken = null;
      user.resetTokenExpiry = null;
      await user.save();
      
      // Provide more specific error message
      const errorMessage = emailError.message || 'Failed to send password reset email. Please try again later.';
      console.error('Detailed email error:', {
        message: emailError.message,
        code: emailError.code,
        stack: emailError.stack
      });
      
      return res.status(500).json({
        success: false,
        message: errorMessage
      });
    }

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during password reset request'
    });
  }
};

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const { token, email, password } = req.body;

    // Validate input
    if (!token || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide token, email, and new password'
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Find user with reset token
    const user = await User.findOne({
      email: email.toLowerCase(),
      resetToken: token,
      resetTokenExpiry: { $gt: new Date() } // Token must not be expired
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Update password
    user.password = password;
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();

    res.json({
      success: true,
      message: 'Password has been reset successfully'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during password reset'
    });
  }
};

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Validate input
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and OTP'
      });
    }

    // Find user with matching OTP
    const user = await User.findOne({
      email: email.toLowerCase(),
      otp: otp,
      otpExpiry: { $gt: new Date() } // OTP must not be expired
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Verify email
    user.isEmailVerified = true;
    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: {
        user: formatUserResponse(user),
        token
      }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during OTP verification'
    });
  }
};

// @desc    Resend OTP
// @route   POST /api/auth/resend-otp
// @access  Public
const resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email address'
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      // Always return success to prevent email enumeration
      return res.json({
        success: true,
        message: 'If an account with that email exists, a new OTP has been sent.'
      });
    }

    // Check if already verified
    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified'
      });
    }

    // Generate new 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP to user
    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    // Send OTP email
    try {
      await sendOTPEmail(user.email, otp, user.firstname);
    } catch (emailError) {
      console.error('Error sending OTP email:', emailError);
      // Clear the OTP if email fails
      user.otp = null;
      user.otpExpiry = null;
      await user.save();
      
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP email. Please try again later.'
      });
    }

    res.json({
      success: true,
      message: 'If an account with that email exists, a new OTP has been sent.'
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during OTP resend'
    });
  }
};

module.exports = {
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
};
