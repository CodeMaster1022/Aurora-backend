const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Session title is required'],
    trim: true
  },
  speaker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Speaker is required']
  },
  learner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Learner is required']
  },
  date: {
    type: Date,
    required: [true, 'Date is required']
  },
  time: {
    type: String,
    required: [true, 'Time is required']
  },
  duration: {
    type: Number,
    required: [true, 'Duration is required'],
    min: 15,
    max: 120
  },
  status: {
    type: String,
    enum: ['scheduled', 'completed', 'cancelled'],
    default: 'scheduled'
  },
  topic: {
    type: String,
    trim: true
  },
  topics: [{
    type: String,
    trim: true
  }],
  icebreaker: {
    type: String,
    trim: true
  },
  meetingLink: {
    type: String,
    trim: true
  },
  notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
sessionSchema.index({ speaker: 1, date: 1 });
sessionSchema.index({ learner: 1, date: 1 });

module.exports = mongoose.model('Session', sessionSchema);

