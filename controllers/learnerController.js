const User = require('../models/User');
const Session = require('../models/Session');
const Review = require('../models/Review');
const { uploadImage } = require('../utils/cloudinary');
const { createCalendarEvent, getRandomIcebreaker, generateMeetLink } = require('../utils/googleCalendar');
const { sendSessionEmails } = require('../utils/emailService');

// @desc    Get learner dashboard data
// @route   GET /api/learner/dashboard
// @access  Private (Learner)
const getDashboard = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get upcoming sessions (scheduled)
    const upcomingSessions = await Session.find({
      learner: userId,
      status: 'scheduled',
      date: { $gte: new Date() }
    })
      .populate('speaker', 'firstname lastname email avatar bio')
      .sort({ date: 1, time: 1 });

    // Get past sessions (completed or cancelled)
    const pastSessions = await Session.find({
      learner: userId,
      status: { $in: ['completed', 'cancelled'] }
    })
      .populate('speaker', 'firstname lastname email avatar')
      .sort({ date: -1, time: -1 });

    // Count total and completed sessions
    const totalSessions = await Session.countDocuments({ learner: userId });
    const completedSessions = await Session.countDocuments({
      learner: userId,
      status: 'completed'
    });
    const upcomingCount = await Session.countDocuments({
      learner: userId,
      status: 'scheduled'
    });

    res.json({
      success: true,
      data: {
        upcomingSessions,
        pastSessions,
        profile: {
          totalSessions,
          completedSessions,
          upcomingSessions: upcomingCount
        }
      }
    });
  } catch (error) {
    console.error('Get learner dashboard error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get single session details
// @route   GET /api/learner/sessions/:id
// @access  Private (Learner)
const getSession = async (req, res) => {
  try {
    const sessionId = req.params.id;
    const userId = req.user._id;

    const session = await Session.findOne({
      _id: sessionId,
      learner: userId
    }).populate('speaker', 'firstname lastname email avatar bio');

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    res.json({
      success: true,
      data: { session }
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Rate and review a session
// @route   POST /api/learner/sessions/:id/review
// @access  Private (Learner)
const rateSession = async (req, res) => {
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
      learner: userId,
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
      to: session.speaker,
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
    console.error('Rate session error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Update learner profile
// @route   PUT /api/learner/profile
// @access  Private (Learner)
const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { firstname, lastname, bio } = req.body;

    const updateData = {};
    if (firstname) updateData.firstname = firstname;
    if (lastname) updateData.lastname = lastname;
    if (bio !== undefined) updateData.bio = bio;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

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

// @desc    Upload learner avatar
// @route   POST /api/learner/avatar
// @access  Private (Learner)
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

// @desc    Book a session with a speaker
// @route   POST /api/learner/book-session
// @access  Private (Learner)
const bookSession = async (req, res) => {
  try {
    const learnerId = req.user._id;
    const { speakerId, title, date, time, topics } = req.body;

    // Validate required fields
    if (!speakerId || !title || !date || !time) {
      return res.status(400).json({
        success: false,
        message: 'Speaker, title, date, and time are required'
      });
    }

    // Validate topics (max 2)
    if (topics && topics.length > 2) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 2 topics allowed'
      });
    }

    // Check if speaker exists and is active
    const speaker = await User.findOne({
      _id: speakerId,
      role: 'speaker',
      isActive: true
    });

    if (!speaker) {
      return res.status(404).json({
        success: false,
        message: 'Speaker not found or not available'
      });
    }

    // Check if user exists
    const learner = await User.findById(learnerId);
    if (!learner) {
      return res.status(404).json({
        success: false,
        message: 'Learner not found'
      });
    }

    // Generate icebreaker question
    const icebreaker = getRandomIcebreaker();

    // Parse date and time
    const sessionDate = new Date(date);
    const [hours, minutes] = time.split(':').map(Number);
    sessionDate.setHours(hours, minutes, 0, 0);

    // Create calendar event with Google Meet link
    const calendarResult = await createCalendarEvent({
      speakerEmail: speaker.email,
      learnerEmail: learner.email,
      speakerName: `${speaker.firstname} ${speaker.lastname}`,
      learnerName: `${learner.firstname} ${learner.lastname}`,
      sessionTitle: title,
      topics: topics || [],
      icebreaker,
      startDateTime: sessionDate,
      duration: 30 // Always 30 minutes
    });

    // Use the Meet link from calendar event (or fallback)
    const meetLink = calendarResult.meetLink || generateMeetLink();

    // Create the session
    const session = await Session.create({
      title,
      speaker: speakerId,
      learner: learnerId,
      date: sessionDate,
      time,
      duration: 30, // Always 30 minutes
      topics: topics || [],
      icebreaker,
      meetingLink: meetLink,
      status: 'scheduled'
    });

    // Populate speaker data for response
    await session.populate('speaker', 'firstname lastname email');

    // Send confirmation emails to both users
    const emailResults = await sendSessionEmails({
      speakerEmail: speaker.email,
      speakerName: `${speaker.firstname} ${speaker.lastname}`,
      learnerEmail: learner.email,
      learnerName: `${learner.firstname} ${learner.lastname}`,
      sessionTitle: title,
      topics: topics || [],
      icebreaker,
      date: sessionDate,
      time,
      duration: 30,
      meetLink
    });

    // Log email results
    emailResults.forEach(result => {
      if (!result.success) {
        console.error(`Failed to send email to ${result.type}:`, result.error);
      }
    });

    res.status(201).json({
      success: true,
      message: 'Session booked successfully',
      data: {
        session,
        calendar: {
          created: calendarResult.success,
          meetLink
        },
        emails: {
          sent: emailResults.filter(r => r.success).length,
          failed: emailResults.filter(r => !r.success).length
        }
      }
    });
  } catch (error) {
    console.error('Book session error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

module.exports = {
  getDashboard,
  getSession,
  rateSession,
  updateProfile,
  uploadAvatar,
  bookSession
};

