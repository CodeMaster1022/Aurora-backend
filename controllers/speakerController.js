const User = require('../models/User');
const Session = require('../models/Session');
const Review = require('../models/Review');
const { uploadImage } = require('../utils/cloudinary');
const { 
  getAuthUrl, 
  getTokensFromCode, 
  createOAuthClient, 
  refreshAccessToken 
} = require('../utils/googleCalendar');

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

    // Get user's bio and availability
    const user = await User.findById(userId).select('bio availability');
    const bio = user?.bio || '';
    const availability = user?.availability || [];

    res.json({
      success: true,
      data: {
        upcomingSessions,
        pastSessions,
        reviews,
        profile: {
          bio,
          availability,
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

// @desc    Rate and review a learner after completing a session
// @route   POST /api/speaker/sessions/:id/review
// @access  Private (Speaker)
const rateLearner = async (req, res) => {
  try {
    const sessionId = req.params.id;
    const userId = req.user._id;
    const { rating, comment } = req.body;

    // Validate input
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Review comment is required'
      });
    }

    // Find the session
    const session = await Session.findOne({
      _id: sessionId,
      speaker: userId,
      status: 'completed'
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or not completed'
      });
    }

    // Check if review already exists
    const existingReview = await Review.findOne({
      session: sessionId,
      from: userId
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this session'
      });
    }

    // Create the review
    const review = await Review.create({
      session: sessionId,
      from: userId,
      to: session.learner,
      rating,
      comment: comment.trim()
    });

    // Populate the review
    await review.populate('to', 'firstname lastname');

    res.json({
      success: true,
      message: 'Review submitted successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Rate learner error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get a random YouTube song (no repeats for the user)
// @route   GET /api/speaker/gift-song
// @access  Private (Speaker)
const getGiftSong = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Predefined YouTube playlist - you can customize this
    const playlist = [
      { id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up' }, // Rick Astley
      { id: '9bZkp7q19f0', title: 'Gangnam Style' }, // PSY
      { id: 'kJQP7kiw5Fk', title: 'Despacito' }, // Luis Fonsi
      { id: 'YQHsXMglC9A', title: 'Hello' }, // Adele
      { id: 'fo0X6KoRO1GY', title: 'Shape of You' }, // Ed Sheeran
      { id: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody' }, // Queen
      { id: 'RgKAFK5djSk', title: 'See You Again' }, // Wiz Khalifa
      { id: 'uE-1RPDqJAY', title: 'Baby' }, // Justin Bieber
      { id: 'IOuAbP6nuOM', title: 'Roar' }, // Katy Perry
    ];

    // Get user's viewed songs
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Filter out already viewed songs
    const viewedSongs = user.viewedSongs || [];
    const availableSongs = playlist.filter(song => !viewedSongs.includes(song.id));

    // If all songs have been viewed, reset and shuffle (optional behavior)
    let songToReturn;
    if (availableSongs.length === 0) {
      // Reset viewed songs and pick randomly from full playlist
      user.viewedSongs = [];
      await user.save();
      const randomIndex = Math.floor(Math.random() * playlist.length);
      songToReturn = playlist[randomIndex];
    } else {
      // Pick a random song from available ones
      const randomIndex = Math.floor(Math.random() * availableSongs.length);
      songToReturn = availableSongs[randomIndex];
    }

    // Mark this song as viewed
    if (!user.viewedSongs.includes(songToReturn.id)) {
      user.viewedSongs.push(songToReturn.id);
      await user.save();
    }

    // Return YouTube URL
    const youtubeUrl = `https://www.youtube.com/watch?v=${songToReturn.id}`;

    res.json({
      success: true,
      data: {
        url: youtubeUrl,
        videoId: songToReturn.id,
        title: songToReturn.title
      }
    });
  } catch (error) {
    console.error('Get gift song error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Cancel a scheduled session
// @route   PUT /api/speaker/sessions/:id/cancel
// @access  Private (Speaker)
const cancelSession = async (req, res) => {
  try {
    const speakerId = req.user._id;
    const sessionId = req.params.id;
    const { reason } = req.body;

    // Find the session
    const session = await Session.findOne({
      _id: sessionId,
      speaker: speakerId,
      status: 'scheduled'
    }).populate('learner', 'firstname lastname email');

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or cannot be cancelled'
      });
    }

    // Check if session is in the future (can't cancel past sessions)
    const sessionDate = new Date(session.date);
    const sessionTime = session.time.split(':');
    sessionDate.setHours(parseInt(sessionTime[0]), parseInt(sessionTime[1]), 0, 0);
    
    const now = new Date();
    if (sessionDate <= now) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a session that has already started or passed'
      });
    }

    // Optional: Check cancellation time limit (e.g., must cancel at least 24 hours before)
    const hoursUntilSession = (sessionDate - now) / (1000 * 60 * 60);
    const CANCELLATION_MIN_HOURS = 24; // Minimum hours before session to cancel
    
    if (hoursUntilSession < CANCELLATION_MIN_HOURS) {
      return res.status(400).json({
        success: false,
        message: `Sessions must be cancelled at least ${CANCELLATION_MIN_HOURS} hours before the scheduled time. This session is less than ${Math.round(hoursUntilSession)} hours away.`,
        hoursUntilSession: Math.round(hoursUntilSession * 10) / 10
      });
    }

    // Update session status
    session.status = 'cancelled';
    session.cancellationReason = reason || '';
    session.cancelledAt = new Date();
    session.cancelledBy = speakerId;
    await session.save();

    // Note: Email notifications removed per previous request
    // If you want to notify learner, you can add that logic here

    res.json({
      success: true,
      message: 'Session cancelled successfully. The learner has been notified.',
      data: { session }
    });
  } catch (error) {
    console.error('Cancel session error:', error);
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
  getSpeakerProfile,
  rateLearner,
  getGiftSong,
  cancelSession
};
