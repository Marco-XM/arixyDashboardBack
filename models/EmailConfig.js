const mongoose = require('mongoose');

const emailConfigSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  senderPassword: {
    type: String,
    required: true
  },
  senderName: {
    type: String,
    required: true,
    trim: true
  },
  emailService: {
    type: String,
    default: 'gmail',
    enum: ['gmail', 'outlook', 'yahoo', 'custom']
  },
  customHost: {
    type: String,
    trim: true
  },
  customPort: {
    type: Number
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  lastVerified: {
    type: Date
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

emailConfigSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('EmailConfig', emailConfigSchema);
