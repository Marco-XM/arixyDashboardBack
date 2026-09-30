const mongoose = require('mongoose');

// Singleton (key: 'reports') holding the agency branding printed on client
// reports: logo, name, contact line and accent colour. Kept apart from
// SiteSettings because /api/settings/site is public.
const reportSettingsSchema = new mongoose.Schema({
    key: { type: String, default: 'reports', unique: true, index: true },
    brandName: { type: String, trim: true, default: 'Arixy Tech' },
    // Empty → the bundled Arixy logo (assets/arixy-logo.png) is used.
    logoUrl: { type: String, default: '' },
    logoPublicId: { type: String, default: '' },
    website: { type: String, trim: true, default: 'www.arixytech.com' },
    email: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    accentColor: { type: String, trim: true, default: '#4F46E5' },
    // Linked from the PDF sign-off and the report email.
    portalUrl: { type: String, trim: true, default: 'https://www.arixytech.com/portal/reports' },
}, { timestamps: true });

// Atomic upsert so concurrent first requests can't race on the unique key.
reportSettingsSchema.statics.getSingleton = function () {
    return this.findOneAndUpdate(
        { key: 'reports' },
        { $setOnInsert: { key: 'reports' } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );
};

module.exports = mongoose.model('ReportSettings', reportSettingsSchema);
