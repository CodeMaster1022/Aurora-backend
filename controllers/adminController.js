const mongoose = require('mongoose');
const User = require('../models/User');
const Session = require('../models/Session');
const Review = require('../models/Review');

const sanitizeUser = (user) => {
  if (!user) return user;
  const userObj = user.toObject ? user.toObject() : user;
  const { password, ...rest } = userObj;
  return rest;
};

const getAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      totalUsers,
      activeUsers,
      newUsersThisMonth,
      usersByRole,
      totalSessions,
      sessionsByStatus,
      upcomingSessions,
      completedSessions,
      reviewCount,
      reviewStats,
      revenueTotals,
      monthlyRevenueRaw,
      topSpeakersRaw,
      songUsageStats,
      connectedCalendars
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ createdAt: { $gte: startOfMonth } }),
      User.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } }
      ]),
      Session.countDocuments(),
      Session.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Session.countDocuments({ status: 'scheduled', date: { $gte: now } }),
      Session.countDocuments({ status: 'completed' }),
      Review.countDocuments(),
      Review.aggregate([
        {
          $group: {
            _id: null,
            averageRating: { $avg: '$rating' },
            fiveStarReviews: {
              $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] }
            }
          }
        }
      ]),
      Session.aggregate([
        {
          $match: {
            status: 'completed',
            price: { $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$price' },
            averageTicket: { $avg: '$price' }
          }
        }
      ]),
      Session.aggregate([
        {
          $match: {
            status: 'completed',
            createdAt: { $gte: sixMonthsAgo }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' }
            },
            total: { $sum: '$price' },
            sessions: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),
      Review.aggregate([
        {
          $group: {
            _id: '$to',
            reviewsCount: { $sum: 1 },
            averageRating: { $avg: '$rating' }
          }
        },
        { $sort: { averageRating: -1, reviewsCount: -1 } },
        { $limit: 5 }
      ]),
      User.aggregate([
        {
          $match: {
            viewedSongs: { $exists: true, $ne: [] }
          }
        },
        {
          $project: {
            viewedCount: { $size: '$viewedSongs' },
            viewedSongs: 1
          }
        },
        {
          $group: {
            _id: null,
            totalShares: { $sum: '$viewedCount' },
            averagePerSpeaker: { $avg: '$viewedCount' },
            uniqueSongs: { $addToSet: '$viewedSongs' }
          }
        }
      ]),
      User.countDocuments({ 'googleCalendar.connected': true })
    ]);

    const monthlyRevenue = monthlyRevenueRaw.map((item) => ({
      month: `${item._id.year}-${String(item._id.month).padStart(2, '0')}`,
      total: item.total,
      sessions: item.sessions
    }));

    const roleBreakdown = usersByRole.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    const statusBreakdown = sessionsByStatus.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    let formattedSongStats = {
      totalShares: 0,
      averagePerSpeaker: 0,
      uniqueSongs: 0
    };

    if (songUsageStats.length) {
      const [stats] = songUsageStats;
      const uniqueCollection = stats.uniqueSongs?.flat() || [];
      formattedSongStats = {
        totalShares: stats.totalShares || 0,
        averagePerSpeaker: stats.averagePerSpeaker || 0,
        uniqueSongs: new Set(uniqueCollection).size
      };
    }

    const presenterIds = topSpeakersRaw.map((item) => item._id);
    let topSpeakers = [];

    if (presenterIds.length) {
      const speakerDocs = await User.find({ _id: { $in: presenterIds } })
        .select('firstname lastname email avatar role bio')
        .lean();
      const speakerMap = speakerDocs.reduce((acc, speaker) => {
        acc[speaker._id.toString()] = speaker;
        return acc;
      }, {});

      topSpeakers = topSpeakersRaw.map((item) => {
        const speaker = speakerMap[item._id.toString()];
        return {
          userId: item._id,
          name: speaker
            ? `${speaker.firstname || ''} ${speaker.lastname || ''}`.trim() || speaker.email
            : 'Unknown',
          avatar: speaker?.avatar || null,
          role: speaker?.role || 'speaker',
          reviewsCount: item.reviewsCount,
          averageRating: item.averageRating
        };
      });
    }

    res.json({
      success: true,
      data: {
        userMetrics: {
          totalUsers,
          activeUsers,
          newUsersThisMonth,
          roleBreakdown
        },
        sessionMetrics: {
          totalSessions,
          upcomingSessions,
          completedSessions,
          statusBreakdown,
          reviewCount,
          averageRating: reviewStats[0]?.averageRating || 0,
          fiveStarReviews: reviewStats[0]?.fiveStarReviews || 0,
          connectedCalendars
        },
        revenueMetrics: {
          totalRevenue: revenueTotals[0]?.totalRevenue || 0,
          averageTicket: revenueTotals[0]?.averageTicket || 0,
          monthlyRevenue
        },
        songMetrics: formattedSongStats,
        topSpeakers
      }
    });
  } catch (error) {
    console.error('Admin analytics error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to load analytics'
    });
  }
};

const listUsers = async (req, res) => {
  try {
    const {
      role,
      status,
      search,
      page = 1,
      limit = 20,
      isActive
    } = req.query;

    const numericLimit = Math.min(parseInt(limit, 10) || 20, 100);
    const numericPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (numericPage - 1) * numericLimit;

    const filter = {};

    if (role) filter.role = role;
    if (status) filter.status = status;
    if (typeof isActive === 'string') {
      filter.isActive = isActive === 'true';
    }

    if (search) {
      filter.$or = [
        { firstname: { $regex: search, $options: 'i' } },
        { lastname: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(numericLimit)
        .select('-password')
        .lean(),
      User.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          page: numericPage,
          pages: Math.ceil(total / numericLimit),
          limit: numericLimit
        }
      }
    });
  } catch (error) {
    console.error('Admin list users error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to load users'
    });
  }
};

const createUser = async (req, res) => {
  try {
    const {
      firstname,
      lastname,
      email,
      password,
      role = 'learner',
      status = 'review',
      isActive = true,
      cost,
      age,
      location,
      bio,
      meetingPreference,
      interests
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email already exists'
      });
    }

    const user = await User.create({
      firstname,
      lastname,
      email,
      password,
      role,
      status,
      isActive,
      cost,
      age,
      location,
      bio,
      meetingPreference,
      interests
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: { user: sanitizeUser(user) }
    });
  } catch (error) {
    console.error('Admin create user error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create user'
    });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      firstname,
      lastname,
      email,
      password,
      role,
      status,
      isActive,
      cost,
      age,
      location,
      bio,
      meetingPreference,
      interests
    } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ email, _id: { $ne: id } });
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: 'Another user already uses this email'
        });
      }
      user.email = email;
    }

    if (firstname !== undefined) user.firstname = firstname;
    if (lastname !== undefined) user.lastname = lastname;
    if (role !== undefined) user.role = role;
    if (status !== undefined) user.status = status;
    if (typeof isActive === 'boolean') user.isActive = isActive;
    if (cost !== undefined) user.cost = cost;
    if (age !== undefined) user.age = age;
    if (location !== undefined) user.location = location;
    if (bio !== undefined) user.bio = bio;
    if (meetingPreference !== undefined) user.meetingPreference = meetingPreference;
    if (Array.isArray(interests)) user.interests = interests;
    if (password) user.password = password;

    await user.save();

    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user: sanitizeUser(user) }
    });
  } catch (error) {
    console.error('Admin update user error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update user'
    });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, isActive } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (status) user.status = status;
    if (typeof isActive === 'boolean') user.isActive = isActive;

    await user.save();

    res.json({
      success: true,
      message: 'User status updated successfully',
      data: { user: sanitizeUser(user) }
    });
  } catch (error) {
    console.error('Admin update user status error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update user status'
    });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await User.deleteOne({ _id: id });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete user'
    });
  }
};

const listReviews = async (req, res) => {
  try {
    const {
      rating,
      from,
      to,
      page = 1,
      limit = 20,
      search
    } = req.query;

    const numericLimit = Math.min(parseInt(limit, 10) || 20, 100);
    const numericPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (numericPage - 1) * numericLimit;

    const filter = {};

    if (rating) {
      filter.rating = Number(rating);
    }

    if (from && mongoose.Types.ObjectId.isValid(from)) {
      filter.from = new mongoose.Types.ObjectId(from);
    }

    if (to && mongoose.Types.ObjectId.isValid(to)) {
      filter.to = new mongoose.Types.ObjectId(to);
    }

    if (search) {
      filter.comment = { $regex: search, $options: 'i' };
    }

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .populate('from', 'firstname lastname role')
        .populate('to', 'firstname lastname role')
        .populate('session', 'title date status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(numericLimit)
        .lean(),
      Review.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          total,
          page: numericPage,
          pages: Math.ceil(total / numericLimit),
          limit: numericLimit
        }
      }
    });
  } catch (error) {
    console.error('Admin list reviews error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to load reviews'
    });
  }
};

const createReview = async (req, res) => {
  try {
    const { session, from, to, rating, comment } = req.body;

    if (!session || !from || !to || !rating) {
      return res.status(400).json({
        success: false,
        message: 'Session, from, to, and rating are required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(session) ||
        !mongoose.Types.ObjectId.isValid(from) ||
        !mongoose.Types.ObjectId.isValid(to)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid identifiers supplied'
      });
    }

    const existing = await Review.findOne({ session, from });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A review for this session and reviewer already exists'
      });
    }

    const review = await Review.create({
      session,
      from,
      to,
      rating,
      comment
    });

    await review.populate('from', 'firstname lastname role');
    await review.populate('to', 'firstname lastname role');
    await review.populate('session', 'title date status');

    res.status(201).json({
      success: true,
      message: 'Review created successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Admin create review error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create review'
    });
  }
};

const updateReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    if (rating !== undefined) review.rating = rating;
    if (comment !== undefined) review.comment = comment;

    await review.save();
    await review.populate('from', 'firstname lastname role');
    await review.populate('to', 'firstname lastname role');
    await review.populate('session', 'title date status');

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Admin update review error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update review'
    });
  }
};

const deleteReview = async (req, res) => {
  try {
    const { id } = req.params;

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    await Review.deleteOne({ _id: id });

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    console.error('Admin delete review error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete review'
    });
  }
};

module.exports = {
  getAnalytics,
  listUsers,
  createUser,
  updateUser,
  updateUserStatus,
  deleteUser,
  listReviews,
  createReview,
  updateReview,
  deleteReview
};

