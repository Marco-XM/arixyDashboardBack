const mongoose = require('mongoose');

const cardDetailsSchema = new mongoose.Schema({
  image: String,
  title: String,
  title_ar: String,
  description: String,
  description_ar: String,
});

const cardSchema = new mongoose.Schema({
  code: String,
  slug: { type: String, unique: true, sparse: true, index: true },
  title: String,
  title_ar: String,
  description: String,
  description_ar: String,
  // Short tagline shown on the project hero/summary
  summary: String,
  summary_ar: String,
  image: String,
  // Rich project detail fields
  gallery: [String],            // additional Cloudinary image URLs
  services: [String],           // e.g. "Web Development", "UI/UX"
  technologies: [String],       // e.g. "React", "Node.js"
  client: String,
  year: String,
  liveUrl: String,
  featured: { type: Boolean, default: false },
  carddetails: [cardDetailsSchema],
}, { timestamps: true });

module.exports = mongoose.model('Card', cardSchema);
