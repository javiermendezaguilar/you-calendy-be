const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    required: true,
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  content: {
    type: String,
    required: true,
    trim: true,
  },
  type: {
    type: String,
    enum: ['note', 'suggestion', 'report'],
    default: 'note',
  },
  reportType: {
    type: String,
    enum: ['service_quality', 'behavior', 'payment', 'other'],
    default: 'other',
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'resolved', 'dismissed'],
    default: 'pending',
  },
  images: [{
    type: String,
    trim: true,
  }],
  response: {
    type: String,
    trim: true,
  },
  respondedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  respondedAt: {
    type: Date,
  },
  reviewNote: {
    type: String,
    trim: true,
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  reviewedAt: {
    type: Date,
  },
}, {
  timestamps: true,
});

// Indexing for faster queries
noteSchema.index({ businessId: 1, clientId: 1 });

const Note = mongoose.model('Note', noteSchema);

module.exports = Note;