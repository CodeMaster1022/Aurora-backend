const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstname: {
    type: String,
    trim: true
  },
  lastname: {
    type: String,
    trim: true
  },
  fullName: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6
  },
  role: {
    type: String,
    enum: ['learner', 'admin', 'moderator', 'speaker'],
    default: 'learner'
  },
  status: {
    type: String,
    enum: ['review', 'failed', 'success'],
    default: 'review'
  },
  lastLogin: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Speaker-specific fields
  interests: [{
    type: String
  }],
  meetingPreference: {
    type: String
  },
  avatar: {
    type: String, // Path to avatar file
    default: null
  },
  bio: {
    type: String,
    trim: true
  },
  availability: [{
    day: {
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    },
    startTime: {
      type: String
    },
    endTime: {
      type: String
    },
    isAvailable: {
      type: Boolean,
      default: true
    }
  }],
  // Track viewed YouTube songs to prevent repeats
  viewedSongs: [{
    type: String // YouTube video IDs
  }],
  // Google Calendar OAuth2 tokens for speakers
  googleCalendarTokens: {
    accessToken: {
      type: String,
      default: null
    },
    refreshToken: {
      type: String,
      default: null
    },
    tokenType: {
      type: String,
      default: null
    },
    expiryDate: {
      type: Date,
      default: null
    },
    scope: {
      type: String,
      default: null
    }
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  delete userObject.password;
  return userObject;
};

module.exports = mongoose.model('User', userSchema);
