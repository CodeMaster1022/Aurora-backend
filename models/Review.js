const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: [true, 'Session is required']
  },
  from: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Reviewer is required']
  },
  to: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Reviewee is required']
  },
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
reviewSchema.index({ to: 1 });
reviewSchema.index({ from: 1 });
reviewSchema.index({ session: 1 });

// Prevent duplicate reviews for the same session from the same user
reviewSchema.index({ session: 1, from: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);

