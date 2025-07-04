const mongoose = require('mongoose');

const cardDetailsSchema = new mongoose.Schema({
  image: String,
  description: String,
});

const cardSchema = new mongoose.Schema({
  code: String,
  title: String,
  description: String,
  image: String,
  carddetails: [cardDetailsSchema], // ✅ Replaces `pairs`
}, { timestamps: true });

module.exports = mongoose.model('Card', cardSchema);
