const mongoose = require('mongoose');

// A generated document: either a contract or a monthly maintenance report.
// Holds the filled variable values (`data`) and, once generated, the Cloudinary
// URL of the rendered PDF so it can be re-downloaded without re-rendering.
const documentSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['contract', 'maintenance_report'],
        required: true
    },
    title: { type: String, required: true, trim: true },
    number: { type: String, trim: true }, // e.g. contract number
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', required: false },
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'ContractTemplate', required: false },

    // Filled variable values consumed by the renderer (arbitrary keys +
    // optional lineItems / signatures arrays).
    data: { type: mongoose.Schema.Types.Mixed, default: {} },

    // For monthly maintenance reports.
    period: {
        month: { type: Number, min: 1, max: 12 },
        year: { type: Number }
    },

    status: {
        type: String,
        enum: ['draft', 'issued', 'signed'],
        default: 'draft'
    },
    issueDate: { type: Date },

    // Rendered PDF (Cloudinary raw upload).
    pdfUrl: { type: String },
    pdfPublicId: { type: String },
    generatedAt: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: false },
}, { timestamps: true });

documentSchema.index({ company: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('Document', documentSchema);
