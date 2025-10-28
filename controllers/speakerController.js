const User = require('../models/User');
const Session = require('../models/Session');
const Review = require('../models/Review');
const { uploadImage } = require('../utils/cloudinary');

// @desc    Get speaker dashboard data
// @route   GET /api/speaker/dashboard
// @access  Private (Speaker)
const getDashboard = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get upcoming sessions (scheduled)
    const upcomingSessions = await Session.find({
      speaker: userId,
      status: 'scheduled',
      date: { $gte: new Date() }
    })
      .populate('learner', 'firstname lastname email avatar')
      .sort({ date: 1, time: 1 });

    // Get past sessions (completed or cancelled)
    const pastSessions = await Session.find({
      speaker: userId,
      status: { $in: ['completed', 'cancelled'] }
    })
      .populate('learner', 'firstname lastname email avatar')
      .sort({ date: -1, time: -1 });

    // Get reviews
    const reviews = await Review.find({ to: userId })
      .populate('from', 'firstname lastname avatar')
      .sort({ createdAt: -1 })
      .limit(10);

    // Count statistics
    const totalSessions = await Session.countDocuments({ speaker: userId });
    const completedSessions = await Session.countDocuments({
      speaker: userId,
      status: 'completed'
    });

    const avgRating = reviews.length > 0
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : 0;

    res.json({
      success: true,
      data: {
        upcomingSessions,
        pastSessions,
        reviews,
        profile: {
          totalSessions,
          completedSessions,
          rating: avgRating,
          reviewsCount: reviews.length
        }
      }
    });
  } catch (error) {
    console.error('Get speaker dashboard error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Update speaker profile
// @route   PUT /api/speaker/profile
// @access  Private (Speaker)
const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { bio, availability } = req.body;

    const updateData = {};
    if (bio !== undefined) updateData.bio = bio;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    // Handle availability separately if provided
    if (availability) {
      user.availability = availability;
      await user.save();
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Update speaker availability
// @route   PUT /api/speaker/availability
// @access  Private (Speaker)
const updateAvailability = async (req, res) => {
  try {
    const userId = req.user._id;
    const { availability } = req.body;

    if (!availability || !Array.isArray(availability)) {
      return res.status(400).json({
        success: false,
        message: 'Availability must be an array'
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { availability },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Availability updated successfully',
      data: { user }
    });
  } catch (error) {
    console.error('Update availability error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Upload speaker avatar
// @route   POST /api/speaker/avatar
// @access  Private (Speaker)
const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const userId = req.user._id;

    // Upload to Cloudinary
    const result = await uploadImage(req.file.buffer, 'avatars');
    const avatarUrl = result.secure_url;

    // Update user's avatar
    const user = await User.findByIdAndUpdate(
      userId,
      { avatar: avatarUrl },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Avatar uploaded successfully',
      data: { avatarUrl, user }
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get all speakers with optional search and filter
// @route   GET /api/speakers
// @access  Public
const getSpeakers = async (req, res) => {
  try {
    const { search, topic } = req.query;

    // Build query
    const query = {
      role: 'speaker',
      isActive: true,
      status: 'success' // Only show approved speakers
    };

    // Add search filter (by name)
    if (search) {
      query.$or = [
        { firstname: { $regex: search, $options: 'i' } },
        { lastname: { $regex: search, $options: 'i' } }
      ];
    }

    // Add topic/interest filter
    if (topic) {
      query.interests = { $in: [topic] };
    }

    // Get speakers
    const speakers = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 });

    // For each speaker, get their average rating and total reviews
    const speakersWithStats = await Promise.all(
      speakers.map(async (speaker) => {
        const reviews = await Review.find({ to: speaker._id });
        const avgRating = reviews.length > 0
          ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
          : 0;

        const totalSessions = await Session.countDocuments({
          speaker: speaker._id,
          status: 'completed'
        });

        return {
          ...speaker.toObject(),
          rating: avgRating,
          reviewsCount: reviews.length,
          totalSessions
        };
      })
    );

    res.json({
      success: true,
      data: {
        speakers: speakersWithStats,
        count: speakersWithStats.length
      }
    });
  } catch (error) {
    console.error('Get speakers error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get speaker profile by ID
// @route   GET /api/speakers/:id
// @access  Public
const getSpeakerProfile = async (req, res) => {
  try {
    const speakerId = req.params.id;

    const speaker = await User.findOne({
      _id: speakerId,
      role: 'speaker',
      isActive: true
    }).select('-password');

    if (!speaker) {
      return res.status(404).json({
        success: false,
        message: 'Speaker not found'
      });
    }

    // Get rating and reviews
    const reviews = await Review.find({ to: speakerId })
      .populate('from', 'firstname lastname avatar')
      .sort({ createdAt: -1 })
      .limit(10);

    const avgRating = reviews.length > 0
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : 0;

    // Get session statistics
    const totalSessions = await Session.countDocuments({
      speaker: speakerId,
      status: 'completed'
    });

    res.json({
      success: true,
      data: {
        speaker: {
          ...speaker.toObject(),
          rating: avgRating,
          reviewsCount: reviews.length,
          totalSessions
        },
        reviews
      }
    });
  } catch (error) {
    console.error('Get speaker profile error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

module.exports = {
  getDashboard,
  updateProfile,
  updateAvailability,
  uploadAvatar,
  getSpeakers,
  getSpeakerProfile
};
