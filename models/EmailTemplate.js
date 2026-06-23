const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  isHtml: {
    type: Boolean,
    default: false
  },
  // Real email attachments (files/videos/docs) hosted on Cloudinary and saved
  // with the template so they can be reused. Sent as actual attachments.
  attachments: [{
    filename: { type: String },
    url: { type: String },
    publicId: { type: String },
    mimetype: { type: String },
    size: { type: Number },
    resourceType: { type: String }
  }],
  // When true the template is visible to every dashboard user (shared library).
  // Only the creator can edit/delete/re-toggle it.
  isPublic: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Captured at save time for the "shared by" label. createdBy may reference an
  // Admin id while the ref is 'User', so populate is unreliable — store the name.
  createdByName: {
    type: String,
    trim: true
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

templateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('EmailTemplate', templateSchema);
