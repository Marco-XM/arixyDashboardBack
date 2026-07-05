const mongoose = require('mongoose');

// Singleton document (key: 'site') holding website-wide settings managed from
// the dashboard, e.g. the landing hero background (image or video).
const siteSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'site', unique: true, index: true },
  heroMedia: {
    url: { type: String, default: '' },
    type: { type: String, enum: ['image', 'video', ''], default: '' },
    publicId: { type: String, default: '' },
  },
}, { timestamps: true });

// Fetch the singleton, creating it on first access.
siteSettingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ key: 'site' });
  if (!doc) doc = await this.create({ key: 'site' });
  return doc;
};

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
