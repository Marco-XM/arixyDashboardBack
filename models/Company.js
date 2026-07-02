const mongoose = require('mongoose');

// A real client company Arixy works with. This is intentionally separate from
// the display-only `Client` model (which is just the website logo showcase).
// A Company owns its staff accounts (CompanyUser), subscriptions, documents,
// invoices and tickets.
const companySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    logo: {
        type: String,
        required: false
    },
    cloudinaryId: {
        type: String,
        required: false
    },
    contactEmail: {
        type: String,
        required: false,
        trim: true,
        lowercase: true
    },
    phone: {
        type: String,
        required: false,
        trim: true
    },
    address: {
        type: String,
        required: false,
        trim: true
    },
    website: {
        type: String,
        required: false,
        trim: true
    },
    industry: {
        type: String,
        required: false,
        trim: true
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    notes: {
        type: String,
        required: false,
        trim: true
    }
}, {
    timestamps: true
});

companySchema.index({ status: 1, name: 1 });
companySchema.index({ name: 1 });

module.exports = mongoose.model('Company', companySchema);
