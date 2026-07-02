const mongoose = require('mongoose');

const blogSchema = new mongoose.Schema({
  title: { type: String, required: true },
  title_ar: String,
  slug: { type: String, unique: true, index: true },
  excerpt: String,
  excerpt_ar: String,
  body: String,          // HTML content (English / default)
  body_ar: String,       // HTML content (Arabic)
  coverImage: String,    // Cloudinary URL
  tags: [String],
  author: String,
  published: { type: Boolean, default: false },
  // SEO overrides
  seoTitle: String,
  seoTitle_ar: String,
  seoDescription: String,
  seoDescription_ar: String,
}, { timestamps: true });

module.exports = mongoose.model('Blog', blogSchema);
