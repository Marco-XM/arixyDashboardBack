const mongoose = require('mongoose');

// Catalogue of services Arixy offers (e.g. "Website Maintenance", "SEO").
// Distinct from the free-text services[] on portfolio Cards.
const serviceSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    name_ar: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: '' },
    defaultFee: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    billingCycle: {
        type: String,
        enum: ['monthly', 'annual', 'one-time'],
        default: 'monthly'
    },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: true });

module.exports = mongoose.model('Service', serviceSchema);
