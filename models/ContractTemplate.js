const mongoose = require('mongoose');

// A single block inside a template. Mirrors the Acerta section schema so the
// same drag-drop editor concept applies. Rendered by utils/htmlPdfRenderer.js.
const sectionSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['text', 'table', 'signatures', 'link', 'bulletList', 'image'],
        default: 'text'
    },
    title: { type: String, trim: true, default: '' },
    content: { type: String, trim: true, default: '' },

    // Table
    tableData: {
        headers: [String],
        rows: [[String]],
        dynamicSource: { type: String, enum: ['none', 'lineItems'], default: 'none' },
    },

    // Bullet list
    bulletItems: [String],
    bulletStyle: {
        type: String,
        enum: ['dot', 'number', 'letter', 'letterUpper', 'roman', 'dash', 'arrow'],
        default: 'dot'
    },
    bulletIndent: { type: Number, default: 20 },

    // Image
    imageURL: { type: String, default: '' },
    imageWidth: { type: Number, default: 200 },
    imageHeight: { type: Number, default: 150 },
    imageAlignment: { type: String, enum: ['left', 'center', 'right'], default: 'center' },

    // Logo (rendered above the section)
    logoURL: { type: String, default: '' },
    logoAlignment: { type: String, enum: ['left', 'center', 'right'], default: 'center' },
    logoWidth: { type: Number, default: 150 },
    logoHeight: { type: Number, default: 80 },

    // Signatures
    signatureAlignment: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
    showSignatureName: { type: Boolean, default: true },

    // Link
    linkURL: { type: String, default: '' },
    linkText: { type: String, default: '' },

    // Styling / layout
    fontSize: { type: Number, default: 11 },
    isBold: { type: Boolean, default: false },
    alignment: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
    textColor: { type: String, default: '#000000' },
    width: { type: String, enum: ['full', 'half'], default: 'full' },
    pageBreakBefore: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
}, { _id: false });

const contractTemplateSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, trim: true, default: '' },
    headerText: { type: String, default: '' },
    customSections: [sectionSchema],
    // Page/block format produced by the rich editor (ported from Acerta).
    // Array of { id, title, blocks: [...] }. Stored as Mixed for flexibility.
    pages: { type: mongoose.Schema.Types.Mixed, default: [] },
    // Which document type this template targets.
    category: {
        type: String,
        enum: ['all', 'contract', 'maintenance_report'],
        default: 'all'
    },
    isDefault: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: false },
}, { timestamps: true });

// Only one default template per category.
contractTemplateSchema.pre('save', async function (next) {
    if (this.isDefault) {
        await this.constructor.updateMany(
            { _id: { $ne: this._id }, category: this.category },
            { isDefault: false }
        );
    }
    next();
});

module.exports = mongoose.model('ContractTemplate', contractTemplateSchema);
