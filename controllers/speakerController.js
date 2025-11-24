const User = require('../models/User');
const Session = require('../models/Session');
const Review = require('../models/Review');
const Playlist = require('../models/Playlist');
const { uploadImage } = require('../utils/cloudinary');
const { 
  getAuthUrl, 
  getTokensFromCode, 
  createOAuthClient, 
  refreshAccessToken 
} = require('../utils/googleCalendar');
const { searchYouTubeVideos, getPlaylistVideos } = require('../utils/youtube');
const { 
  notifySessionCancelled, 
  notifySessionCompleted,
  notifyReviewReceived 
} = require('../utils/notificationService');

const DEFAULT_GIFT_PLAYLIST = [
  { id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up' }, // Rick Astley
  { id: '9bZkp7q19f0', title: 'Gangnam Style' }, // PSY
  { id: 'kJQP7kiw5Fk', title: 'Despacito' }, // Luis Fonsi
  { id: 'YQHsXMglC9A', title: 'Hello' }, // Adele
  { id: 'fo0X6KoRO1GY', title: 'Shape of You' }, // Ed Sheeran
  { id: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody' }, // Queen
  { id: 'RgKAFK5djSk', title: 'See You Again' }, // Wiz Khalifa
  { id: 'uE-1RPDqJAY', title: 'Baby' }, // Justin Bieber
  { id: 'IOuAbP6nuOM', title: 'Roar' } // Katy Perry
];

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

    // Get reviews - both received (to speaker) and given (from speaker)
    const reviewsReceived = await Review.find({ to: userId })
      .populate('from', 'firstname lastname avatar email')
      .sort({ createdAt: -1 });
    console.log(reviewsReceived, "=======")
    const reviewsGiven = await Review.find({ from: userId })
      .populate('to', 'firstname lastname avatar email')
      .sort({ createdAt: -1 });
    console.log(reviewsGiven, "================>>")
    // Combine both types of reviews with a type indicator
    // Explicitly set type field for each review
    const reviews = [
      ...reviewsReceived.map(r => {
        const reviewObj = r.toObject();
        reviewObj.type = 'received';
        return reviewObj;
      }),
      ...reviewsGiven.map(r => {
        const reviewObj = r.toObject();
        reviewObj.type = 'given';
        return reviewObj;
      })
    ];
    
    // Count statistics
    const totalSessions = await Session.countDocuments({ speaker: userId });
    const completedSessions = await Session.countDocuments({
      speaker: userId,
      status: 'completed'
    });

    // Calculate average rating from received reviews only
    const avgRating = reviewsReceived.length > 0
      ? reviewsReceived.reduce((sum, review) => sum + review.rating, 0) / reviewsReceived.length
      : 0;

    // Get user's bio, availability, age, and cost
    const user = await User.findById(userId).select('bio availability age cost location');
    const bio = user?.bio || '';
    const availability = user?.availability || [];
    const age = user?.age || undefined;
    const cost = user?.cost || undefined;
    const location = user?.location || '';
    console.log(reviews, "==============reviews")
    res.json({
      success: true,
      data: {
        upcomingSessions,
        pastSessions,
        reviews,
        profile: {
          bio,
          availability,
          age,
          cost,
          location,
          totalSessions,
          completedSessions,
          rating: avgRating,
          reviewsCount: reviewsReceived.length
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
    const { bio, availability, age, cost, location } = req.body;

    const updateData = {};
    if (bio !== undefined) updateData.bio = bio;
    if (age !== undefined) updateData.age = age;
    if (cost !== undefined) updateData.cost = cost;
    if (location !== undefined) updateData.location = location;

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

    // Get user to verify they exist
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Save availability as-is without any time conversion
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { availability: availability },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Availability updated successfully',
      data: { user: updatedUser }
    });
  } catch (error) {
    console.error('Update availability error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Update speaker interests
// @route   PUT /api/speaker/interests
// @access  Private (Speaker)
const updateInterests = async (req, res) => {
  try {
    const userId = req.user._id;
    const { interests } = req.body;

    if (!interests || !Array.isArray(interests)) {
      return res.status(400).json({
        success: false,
        message: 'Interests must be an array'
      });
    }

    // Validate max 4 interests
    if (interests.length > 4) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 4 interests allowed'
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { interests },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Interests updated successfully',
      data: { user }
    });
  } catch (error) {
    console.error('Update interests error:', error);
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

// @desc    Get available topics/interests
// @route   GET /api/speakers/topics
// @access  Public
const getTopics = async (req, res) => {
  try {
    // Define available topics - can be moved to a database or config later
    const topics = [
      "Technology", "Business", "Science", "Art", "Music", 
      "Sports", "Travel", "Food", "Health", "Education",
      "Fashion", "Literature", "History", "Languages", "Gaming"
    ];

    res.json({
      success: true,
      data: { topics }
    });
  } catch (error) {
    console.error('Get topics error:', error);
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
    }).select('-password -googleCalendar.accessToken -googleCalendar.refreshToken');

    if (!speaker) {
      return res.status(404).json({
        success: false,
        message: 'Speaker not found'
      });
    }

    // Get rating and reviews
    const reviews = await Review.find({ to: speakerId })
      .populate('from', 'firstname lastname avatar email')
      .sort({ createdAt: -1 });
    
    const avgRating = reviews.length > 0
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : 0;

    // Get session statistics
    const totalSessions = await Session.countDocuments({
      speaker: speakerId,
      status: 'completed'
    });

    // Ensure googleCalendar.timezone is included in response
    const speakerData = speaker.toObject();
    
    res.json({
      success: true,
      data: {
        speaker: {
          ...speakerData,
          rating: avgRating,
          reviewsCount: reviews.length,
          totalSessions,
          // Explicitly include googleCalendar with timezone (but not sensitive tokens)
          googleCalendar: speakerData.googleCalendar ? {
            timezone: speakerData.googleCalendar.timezone,
            connected: speakerData.googleCalendar.connected,
            expiresAt: speakerData.googleCalendar.expiresAt
          } : undefined
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
    console.log(existingReview,'existing review')
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
    await review.populate('to', 'firstname lastname email');
    await review.populate('from', 'firstname lastname email');

    // Send notification to reviewed user
    try {
      const reviewedUser = await User.findById(session.learner);
      await notifyReviewReceived(review, reviewedUser);
    } catch (notifError) {
      console.error('Error sending review notification:', notifError);
      // Don't fail the request if notification fails
    }

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

// @desc    Get a random YouTube song from the speakers' era playlist (no repeats for the user)
// @route   GET /api/speaker/gift-song
// @access  Private (Speaker)
const getGiftSong = async (req, res) => {
  console.log('=== getGiftSong called ===');
  try {
    const userId = req.user._id;
    console.log(`Getting gift song for user: ${userId}`);
    const user = await User.findById(userId);

    if (!user) {
      console.error('User not found:', userId);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // The playlist ID from Mónica's selected playlist
    const SPEAKERS_ERA_PLAYLIST_ID = 'PLBiB9alE5_uImDlLoKvOgB3hXatzs0IPX';
    console.log(`Using playlist ID: ${SPEAKERS_ERA_PLAYLIST_ID}`);
    
    // Check if we should force refresh from API (optional query parameter)
    const forceRefresh = req.query?.refresh === 'true';
    
    let playlist = [];
    let playlistFromDB = null;

    // First, try to get playlist from database
    if (!forceRefresh) {
      console.log('Checking database for existing playlist...');
      playlistFromDB = await Playlist.findOne({ playlistId: SPEAKERS_ERA_PLAYLIST_ID });
      
      if (playlistFromDB && playlistFromDB.videos && playlistFromDB.videos.length > 0) {
        console.log(`Found playlist in DB with ${playlistFromDB.videos.length} videos`);
        console.log(`Playlist last updated: ${playlistFromDB.lastUpdated}`);
        playlist = playlistFromDB.videos;
      } else {
        console.log('No playlist found in database, will fetch from API');
      }
    } else {
      console.log('Force refresh requested, will fetch from API');
    }

    // If not in DB or force refresh, fetch from YouTube API
    if (playlist.length === 0) {
      console.log('Fetching playlist from YouTube API...');
      
      if (!process.env.YOUTUBE_API_KEY) {
        console.error('YouTube API key is not configured');
        return res.status(500).json({
          success: false,
          message: 'YouTube API key is not configured. Cannot fetch playlist songs.'
        });
      }

      try {
        console.log(`Calling getPlaylistVideos with playlistId: ${SPEAKERS_ERA_PLAYLIST_ID}`);
        const playlistVideos = await getPlaylistVideos({
          playlistId: SPEAKERS_ERA_PLAYLIST_ID,
          maxResults: 50
        });

        console.log(`getPlaylistVideos returned ${playlistVideos.length} videos`);

        if (playlistVideos.length === 0) {
          console.error('No videos found in playlist');
          return res.status(500).json({
            success: false,
            message: 'No videos found in the specified playlist. Please contact support.'
          });
        }

        playlist = playlistVideos;
        console.log(`Successfully fetched ${playlist.length} videos from playlist ${SPEAKERS_ERA_PLAYLIST_ID}`);
        console.log('First 3 video IDs from playlist:', playlist.slice(0, 3).map(v => v.id));

        // Save or update playlist in database
        if (playlistFromDB) {
          console.log('Updating existing playlist in database...');
          playlistFromDB.videos = playlist;
          playlistFromDB.totalVideos = playlist.length;
          playlistFromDB.lastUpdated = new Date();
          await playlistFromDB.save();
          console.log('Playlist updated in database');
        } else {
          console.log('Creating new playlist entry in database...');
          await Playlist.create({
            playlistId: SPEAKERS_ERA_PLAYLIST_ID,
            videos: playlist,
            totalVideos: playlist.length,
            lastUpdated: new Date()
          });
          console.log('Playlist saved to database');
        }
      } catch (youtubeError) {
        console.error('YouTube playlist error:', youtubeError);
        console.error('Error details:', {
          message: youtubeError.message,
          code: youtubeError.code,
          stack: youtubeError.stack
        });
        
        // If we have a cached version, use it as fallback
        if (playlistFromDB && playlistFromDB.videos && playlistFromDB.videos.length > 0) {
          console.log('Using cached playlist from database as fallback');
          playlist = playlistFromDB.videos;
        } else {
          return res.status(500).json({
            success: false,
            message: `Failed to fetch playlist: ${youtubeError.message || 'Unknown error'}`
          });
        }
      }
    }

    // Create a Set of valid video IDs from the playlist for validation
    const validPlaylistVideoIds = new Set(playlist.map(song => song.id).filter(Boolean));
    console.log(`Playlist contains ${validPlaylistVideoIds.size} valid videos`);
    console.log('Sample video IDs from playlist:', Array.from(validPlaylistVideoIds).slice(0, 5));

    const viewedSongs = Array.isArray(user.viewedSongs) ? user.viewedSongs : [];
    console.log(`User has viewed ${viewedSongs.length} songs previously`);
    if (viewedSongs.length > 0) {
      console.log('Previously viewed song IDs:', viewedSongs.slice(0, 10));
    }
    
    // Filter to only include songs from the playlist that haven't been viewed
    console.log('Filtering available songs...');
    let availableSongs = playlist.filter(song => {
      if (!song || !song.id) {
        console.warn('Filtering out song without ID:', song);
        return false;
      }
      // Ensure the song ID is in our valid playlist set (double-check)
      if (!validPlaylistVideoIds.has(song.id)) {
        console.warn(`Warning: Song ID ${song.id} not found in playlist validation set`);
        return false;
      }
      const isViewed = viewedSongs.includes(song.id);
      if (isViewed) {
        console.log(`Song ${song.id} (${song.title}) already viewed, skipping`);
      }
      return !isViewed;
    });

    console.log(`Found ${availableSongs.length} available songs (not yet viewed)`);

    // If all songs have been viewed, reset and start over
    if (availableSongs.length === 0) {
      console.log('All songs viewed, resetting viewedSongs array');
      user.viewedSongs = [];
      await user.save();
      availableSongs = playlist.filter(song => {
        if (!song || !song.id) return false;
        return validPlaylistVideoIds.has(song.id);
      });
      console.log(`After reset, ${availableSongs.length} songs available`);
    }

    if (availableSongs.length === 0) {
      console.error('No songs available after all filtering');
      return res.status(500).json({
        success: false,
        message: 'No songs available. Please try again later.'
      });
    }

    console.log(`Selecting random song from ${availableSongs.length} available songs`);
    const randomIndex = Math.floor(Math.random() * availableSongs.length);
    console.log(`Random index selected: ${randomIndex}`);
    const songToReturn = availableSongs[randomIndex];

    if (!songToReturn || !songToReturn.id) {
      console.error('Invalid song data returned:', songToReturn);
      return res.status(500).json({
        success: false,
        message: 'Invalid song data. Please try again.'
      });
    }

    // Verify the selected song is actually in the playlist
    if (!validPlaylistVideoIds.has(songToReturn.id)) {
      console.error(`ERROR: Selected song ${songToReturn.id} is not in the playlist!`);
      console.error('Selected song:', songToReturn);
      console.error('Valid playlist IDs:', Array.from(validPlaylistVideoIds).slice(0, 10));
      return res.status(500).json({
        success: false,
        message: 'Selected song is not in the playlist. Please try again.'
      });
    }

    // Log the selected song for debugging
    console.log(`✓ Selected random song from playlist: "${songToReturn.title}" (ID: ${songToReturn.id})`);
    console.log(`✓ Song is validated in playlist: ${validPlaylistVideoIds.has(songToReturn.id)}`);

    if (!user.viewedSongs.includes(songToReturn.id)) {
      console.log(`Adding song ${songToReturn.id} to viewedSongs array`);
      user.viewedSongs.push(songToReturn.id);
      await user.save();
      console.log(`User now has ${user.viewedSongs.length} viewed songs`);
    } else {
      console.log(`Song ${songToReturn.id} already in viewedSongs, not adding again`);
    }

    // Return URL that plays the video (which will show the playlist in the sidebar)
    const youtubeUrl = `https://www.youtube.com/watch?v=${songToReturn.id}&list=${SPEAKERS_ERA_PLAYLIST_ID}`;
    console.log(`Generated YouTube URL: ${youtubeUrl}`);

    console.log('=== Returning success response ===');
    res.json({
      success: true,
      data: {
        url: youtubeUrl,
        videoId: songToReturn.id,
        title: songToReturn.title || 'YouTube Video'
      }
    });
  } catch (error) {
    console.error('=== Get gift song error ===');
    console.error('Error:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
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

    // Populate speaker for notification
    await session.populate('speaker', 'firstname lastname email');

    // Send notification to learner
    try {
      const speaker = await User.findById(speakerId);
      const learner = session.learner;
      await notifySessionCancelled(session, speaker, learner);
    } catch (notifError) {
      console.error('Error sending cancellation notification:', notifError);
      // Don't fail the request if notification fails
    }

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

// @desc    Complete a scheduled session
// @route   PUT /api/speaker/sessions/:id/complete
// @access  Private (Speaker)
const completeSession = async (req, res) => {
  try {
    const speakerId = req.user._id;
    const sessionId = req.params.id;

    // Find the session
    const session = await Session.findOne({
      _id: sessionId,
      speaker: speakerId,
      status: 'scheduled'
    }).populate('learner', 'firstname lastname email');

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or cannot be completed'
      });
    }

    // Update session status to completed
    session.status = 'completed';
    await session.save();

    // Populate session data for notifications
    await session.populate('speaker', 'firstname lastname email');
    await session.populate('learner', 'firstname lastname email');

    // Send notifications
    try {
      const speaker = await User.findById(speakerId);
      const learner = session.learner;
      await notifySessionCompleted(session, speaker, 'speaker');
      await notifySessionCompleted(session, learner, 'learner');
    } catch (notifError) {
      console.error('Error sending completion notifications:', notifError);
      // Don't fail the request if notification fails
    }

    res.json({
      success: true,
      message: 'Session marked as completed successfully',
      data: { session }
    });
  } catch (error) {
    console.error('Complete session error:', error);
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
  updateInterests,
  uploadAvatar,
  getSpeakers,
  getSpeakerProfile,
  getTopics,
  rateLearner,
  getGiftSong,
  cancelSession,
  completeSession
};
