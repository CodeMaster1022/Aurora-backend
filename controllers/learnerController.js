const User = require('../models/User');
const Session = require('../models/Session');
const Review = require('../models/Review');
const { uploadImage } = require('../utils/cloudinary');
const { 
  createCalendarEvent, 
  getRandomIcebreaker, 
  generateMeetLink, 
  createOAuthClient,
  refreshAccessToken,
  getValidOAuthClient
} = require('../utils/googleCalendar');
const { createDonationCheckout } = require('../utils/stripe');
const { notifySessionBooked, notifySessionCancelled } = require('../utils/notificationService');

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

    // Get reviews given by this learner
    const reviews = await Review.find({ from: userId })
      .populate('to', 'firstname lastname avatar')
      .populate('session', 'title date time')
      .sort({ createdAt: -1 });

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
        reviews,
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

    // Comment is optional, so we don't validate it here

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
    // console.log(existingReview,'existing review')
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
      comment: comment ? comment.trim() : ''
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

    // Log the incoming request for debugging
    console.log('Book session request:', { speakerId, title, date, time, topics });

    // Validate required fields
    if (!speakerId || !title || !date || !time) {
      console.log('Validation failed - missing fields:', { 
        speakerId: !!speakerId, 
        title: !!title, 
        date: !!date, 
        time: !!time 
      });
      return res.status(400).json({
        success: false,
        message: 'Speaker, title, date, and time are required'
      });
    }

    // Validate topics (max 2) - filter out empty strings
    const validTopics = topics ? topics.filter(t => t && typeof t === 'string' && t.trim().length > 0) : [];
    if (validTopics.length > 2) {
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

    // Check if speaker has Google Calendar connected
    if (!speaker.googleCalendar?.connected) {
      return res.status(400).json({
        success: false,
        message: 'Speaker has not connected their Google Calendar. Please contact the speaker to connect their calendar first.'
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

    // Parse date and time - time is in speaker's timezone
    // Date from HTML input is in YYYY-MM-DD format
    // Time from frontend is in HH:MM format in speaker's timezone
    // Get speaker's timezone for date calculations
    const speakerTimezone = speaker.googleCalendar?.timezone || 'UTC';
    
    // Validate time format first
    const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      console.log('Invalid time format:', time);
      return res.status(400).json({
        success: false,
        message: 'Invalid time format. Please use HH:MM format'
      });
    }

    const [hours, minutes] = timeMatch.slice(1).map(Number);
    
    // Validate hours and minutes
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      console.log('Invalid time values:', { hours, minutes });
      return res.status(400).json({
        success: false,
        message: 'Invalid time. Hours must be 0-23 and minutes 0-59'
      });
    }

    // Parse date components
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use YYYY-MM-DD format'
      });
    }

    // Helper function to convert local date/time in a specific timezone to UTC Date object
    const convertToUTCFromTimezone = (year, month, day, hours, minutes, timezone) => {
      try {
        // Create a UTC date at the target date/time (as if it were UTC)
        const tempDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
        
        // Get what time this UTC date is in the target timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        
        const parts = formatter.formatToParts(tempDate);
        const tzHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
        const tzMin = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
        
        // Calculate the offset: if UTC time shows as H:M in timezone, what's the offset?
        // If we want H:M in timezone and UTC shows as TZ_H:TZ_M, then offset = TZ_H*60 + TZ_M - (H*60 + M)
        const desiredTotalMinutes = hours * 60 + minutes;
        const tzTotalMinutes = tzHour * 60 + tzMin;
        const offsetMinutes = tzTotalMinutes - desiredTotalMinutes;
        
        // Adjust the UTC date by the offset
        const utcDate = new Date(tempDate);
        utcDate.setUTCMinutes(utcDate.getUTCMinutes() - offsetMinutes);
        
        return utcDate;
      } catch (error) {
        console.error('Error converting timezone:', error);
        // Fallback: assume UTC if conversion fails
        return new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
      }
    };

    // Convert the session date/time from speaker's timezone to UTC for accurate comparison
    const sessionDateUTC = convertToUTCFromTimezone(year, month, day, hours, minutes, speakerTimezone);
    
    if (isNaN(sessionDateUTC.getTime())) {
      // console.log('Invalid date/time combination:', { date, time, timezone: speakerTimezone });
      return res.status(400).json({
        success: false,
        message: 'Invalid date format or date/time combination'
      });
    }

    // console.log('Parsed session date:', { 
    //   originalDate: date, 
    //   originalTime: time,
    //   timezone: speakerTimezone,
    //   parsedUTC: sessionDateUTC.toISOString()
    // });

    // Validate that session is in the future
    // Compare dates in the speaker's timezone context
    const now = new Date();
    
    // Get current date/time in speaker's timezone
    const nowInSpeakerTZ = new Intl.DateTimeFormat('en-US', {
      timeZone: speakerTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(now);
    
    const nowYear = parseInt(nowInSpeakerTZ.find(p => p.type === 'year')?.value || '0');
    const nowMonth = parseInt(nowInSpeakerTZ.find(p => p.type === 'month')?.value || '0');
    const nowDay = parseInt(nowInSpeakerTZ.find(p => p.type === 'day')?.value || '0');
    const nowHour = parseInt(nowInSpeakerTZ.find(p => p.type === 'hour')?.value || '0');
    const nowMin = parseInt(nowInSpeakerTZ.find(p => p.type === 'minute')?.value || '0');
    
    // Convert current time in speaker's timezone to UTC for comparison
    const nowUTC = convertToUTCFromTimezone(nowYear, nowMonth, nowDay, nowHour, nowMin, speakerTimezone);
    
    if (sessionDateUTC <= nowUTC) {
      // console.log('Session is in the past:', { 
      //   sessionDateUTC: sessionDateUTC.toISOString(), 
      //   nowUTC: nowUTC.toISOString(),
      //   nowInSpeakerTZ: `${nowYear}-${String(nowMonth).padStart(2, '0')}-${String(nowDay).padStart(2, '0')} ${String(nowHour).padStart(2, '0')}:${String(nowMin).padStart(2, '0')}`,
      //   sessionInSpeakerTZ: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      //   timezone: speakerTimezone,
      //   diff: sessionDateUTC - nowUTC
      // });
      return res.status(400).json({
        success: false,
        message: 'Session must be scheduled for a future date and time'
      });
    }

    // Validate availability - check if speaker is available on the requested day and time
    // Calculate day of week from date components (matches frontend calculation)
    // Use UTC date calculation to match frontend logic
    const dateForDayCalc = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = dateForDayCalc.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const requestedDay = dayNames[dayOfWeek];
    
    // Find speaker's availability for the requested day
    const speakerAvailability = speaker.availability || [];
    const dayAvailability = speakerAvailability.find(avail => avail.day === requestedDay);
    
    if (!dayAvailability || !dayAvailability.isAvailable) {
      return res.status(400).json({
        success: false,
        message: `Speaker is not available on ${requestedDay.charAt(0).toUpperCase() + requestedDay.slice(1)}. Please select a day when the speaker is available.`
      });
    }

    // Check if the requested time is within speaker's available hours
    // Note: Availability times are stored in speaker's timezone (HH:MM)
    // The requested time is also in speaker's timezone (sent from frontend)
    const requestedTime = time; // Format: HH:MM (in speaker's timezone)
    const startTime = dayAvailability.startTime || '00:00'; // In speaker's timezone
    const endTime = dayAvailability.endTime || '23:59'; // In speaker's timezone
    
    // Compare times (HH:MM format) - both in speaker's timezone
    const timeToMinutes = (timeStr) => {
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    };
    
    const requestedMinutes = timeToMinutes(requestedTime);
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    
    // Session duration is 30 minutes, so check if session end time is within availability
    const sessionEndMinutes = requestedMinutes + 30;
    
    if (requestedMinutes < startMinutes || sessionEndMinutes > endMinutes) {
      return res.status(400).json({
        success: false,
        message: `Speaker is only available between ${startTime} and ${endTime} on ${requestedDay.charAt(0).toUpperCase() + requestedDay.slice(1)}. Please select a time within this range.`
      });
    }

    // Check for duplicate/overlapping bookings
    // Sessions are 30 minutes, so check for any overlap
    // Use UTC date components for query (matching how sessionDateUTC was created)
    const existingSessions = await Session.find({
      speaker: speakerId,
      date: {
        $gte: new Date(Date.UTC(year, month - 1, day, 0, 0, 0)),
        $lt: new Date(Date.UTC(year, month - 1, day, 23, 59, 59))
      },
      status: { $in: ['scheduled'] } // Only check scheduled sessions
    });

    // Check for time overlaps
    const sessionDuration = 30; // minutes
    for (const existingSession of existingSessions) {
      const existingTime = existingSession.time; // Format: HH:MM
      const existingMinutes = timeToMinutes(existingTime);
      const existingEndMinutes = existingMinutes + sessionDuration;
      
      // Check if there's any overlap
      // Overlap occurs if: requested start < existing end AND requested end > existing start
      if (requestedMinutes < existingEndMinutes && sessionEndMinutes > existingMinutes) {
        return res.status(400).json({
          success: false,
          message: `This time slot is already booked. The speaker has a session at ${existingTime}. Please choose a different time.`
        });
      }
    }

    // Get a valid OAuth client (will automatically refresh token if expired)
    let oauthClient;
    try {
      // Create callback function to update speaker in database
      const updateUserCallback = async (userId, updateData) => {
        await User.findByIdAndUpdate(userId, { $set: updateData });
      };

      // Get valid OAuth client (automatically refreshes token if expired or expiring soon)
      oauthClient = await getValidOAuthClient(speaker, updateUserCallback);
    } catch (tokenError) {
      console.error('Error getting valid OAuth client:', tokenError);
      return res.status(500).json({
        success: false,
        message: 'Failed to access Google Calendar. Please ask the speaker to reconnect their calendar.'
      });
    }

    // Create calendar event with Google Meet link
    // Use the speaker's saved calendar timezone (already retrieved above)
    // The date/time is in speaker's timezone - create Date object that represents it correctly
    // We need to create a Date object from the date/time components as if they're in the speaker's timezone
    // Since Date objects are UTC internally, we'll create it from components
    // and the createCalendarEvent function will use the timezone parameter
    
    // Create Date object for calendar event - use the UTC converted date
    // The createCalendarEvent function will format it correctly for the calendar API
    const calendarStartDate = sessionDateUTC;
    
    const calendarResult = await createCalendarEvent({
      oauthClient,
      speakerEmail: speaker.email,
      learnerEmail: learner.email,
      speakerName: `${speaker.firstname} ${speaker.lastname}`,
      learnerName: `${learner.firstname} ${learner.lastname}`,
      sessionTitle: title,
      topics: validTopics,
      icebreaker,
      startDateTime: calendarStartDate,
      duration: 30, // Always 30 minutes
      timezone: speakerTimezone
    });

    // Use the Meet link from calendar event (or fallback)
    const meetLink = calendarResult.meetLink || generateMeetLink();

    const sessionPrice = typeof speaker.cost === 'number' && !Number.isNaN(speaker.cost)
      ? speaker.cost
      : 0;

    // Create the session
    // Store the date as UTC Date object and time as string in speaker's timezone
    const session = await Session.create({
      title,
      speaker: speakerId,
      learner: learnerId,
      date: sessionDateUTC, // Store as UTC Date for database queries
      time, // Store time string as-is in speaker's timezone
      duration: 30, // Always 30 minutes
      topics: validTopics,
      icebreaker,
      meetingLink: meetLink,
      calendarEventId: calendarResult.eventId || null, // Store calendar event ID for future use
      status: 'scheduled',
      price: sessionPrice,
      currency: 'usd'
    });

    // Populate speaker and learner data for response
    await session.populate('speaker', 'firstname lastname email');
    await session.populate('learner', 'firstname lastname email');

    // Send notifications
    try {
      await notifySessionBooked(session, speaker, learner);
    } catch (notifError) {
      console.error('Error sending notifications:', notifError);
      // Don't fail the request if notification fails
    }

    res.status(201).json({
      success: true,
      message: 'Session booked successfully',
      data: {
        session,
        calendar: {
          created: calendarResult.success,
          meetLink
        }
      }
    });
  } catch (error) {
    console.error('Book session error:', error);
    console.error('Error stack:', error.stack);
    
    // Return 400 for validation errors, 500 for server errors
    const statusCode = error.statusCode || (error.message && error.message.includes('required') ? 400 : 500);
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Server error',
      ...(process.env.NODE_ENV === 'development' && { error: error.toString() })
    });
  }
};

// @desc    Cancel a scheduled session
// @route   PUT /api/learner/sessions/:id/cancel
// @access  Private (Learner)
const cancelSession = async (req, res) => {
  try {
    const learnerId = req.user._id;
    const sessionId = req.params.id;
    const { reason } = req.body;

    // Find the session
    const session = await Session.findOne({
      _id: sessionId,
      learner: learnerId,
      status: 'scheduled'
    }).populate('speaker', 'firstname lastname email');

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
    session.cancelledBy = learnerId;
    await session.save();

    // Populate learner for notification
    await session.populate('learner', 'firstname lastname email');

    // Send notification to speaker
    try {
      const learner = await User.findById(learnerId);
      const speaker = session.speaker;
      await notifySessionCancelled(session, learner, speaker);
    } catch (notifError) {
      console.error('Error sending cancellation notification:', notifError);
      // Don't fail the request if notification fails
    }

    res.json({
      success: true,
      message: 'Session cancelled successfully',
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

// @desc    Create Stripe checkout session for donation
// @route   POST /api/learner/create-donation
// @access  Private (Learner)
const createDonation = async (req, res) => {
  try {
    const userId = req.user._id;
    let { amount = 500 } = req.body; // Default $5.00

    // Validate and normalize amount
    amount = Math.round(Number(amount));
    const MIN_DONATION = 50; // Minimum $0.50
    
    if (isNaN(amount) || amount < MIN_DONATION) {
      return res.status(400).json({
        success: false,
        message: `Minimum donation amount is $${(MIN_DONATION / 100).toFixed(2)}`
      });
    }

    // Get user to get their email
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create success and cancel URLs
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const successUrl = `${baseUrl}/learners/profile?donation=success`;
    const cancelUrl = `${baseUrl}/learners/profile?donation=cancelled`;

    // Check if Stripe is configured before attempting to create checkout
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({
        success: false,
        message: 'Donation feature is currently unavailable. Stripe is not configured on the server.',
        error: 'STRIPE_NOT_CONFIGURED'
      });
    }

    // Create Stripe checkout session
    const checkoutResult = await createDonationCheckout({
      customerEmail: user.email,
      amount: Math.round(amount), // Ensure it's an integer (cents)
      successUrl,
      cancelUrl
    });

    if (!checkoutResult.success) {
      return res.status(500).json({
        success: false,
        message: checkoutResult.error || 'Failed to create checkout session'
      });
    }

    res.json({
      success: true,
      data: {
        sessionId: checkoutResult.sessionId,
        url: checkoutResult.url
      }
    });
  } catch (error) {
    console.error('Create donation error:', error);
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
  bookSession,
  createDonation,
  cancelSession
};

