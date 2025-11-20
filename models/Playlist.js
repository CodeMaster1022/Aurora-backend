const mongoose = require('mongoose');

const playlistSchema = new mongoose.Schema({
  playlistId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  videos: [{
    id: {
      type: String,
      required: true
    },
    title: {
      type: String,
      required: true
    }
  }],
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  totalVideos: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for efficient queries
playlistSchema.index({ playlistId: 1 });

module.exports = mongoose.model('Playlist', playlistSchema);

