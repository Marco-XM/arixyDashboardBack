const mongoose = require('mongoose');

// A client-facing report written by the Arixy team (investigation, audit,
// marketing/SEO review…), shown in the client portal under Documents.
//
// Two sources:
//   - 'editor': built from content blocks in the dashboard and rendered to a
//     branded PDF (utils/clientReportPdf.js). The PDF bytes are stored when
//     the report is published, like ServerReport.
//   - 'upload': a finished PDF uploaded as-is; its bytes live in `pdf.data`
//     from the start.
//
// The portal backend (arixyBackend) reads published reports from the same
// collection and serves `pdf.data`. `pdf.data` is excluded from queries by
// default — select('+pdf.data').

const BLOCK_TYPES = [
    'heading', 'paragraph', 'list', 'callout', 'stats', 'table',
    'image', 'quote', 'actions', 'divider', 'pageBreak',
];

const clientReportSchema = new mongoose.Schema({
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    title: { type: String, trim: true, required: true },
    subtitle: { type: String, trim: true, default: '' },
    // Kicker printed above the title, e.g. "Investigation report".
    category: { type: String, trim: true, default: 'Report' },
    reportDate: { type: Date },
    preparedBy: { type: String, trim: true, default: 'Arixy Team' },

    source: { type: String, enum: ['editor', 'upload'], default: 'editor' },
    // Editor content; shape per type is enforced by the controller's sanitizer.
    blocks: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Original name of an uploaded PDF.
    fileName: { type: String, trim: true, default: '' },

    // Only published reports are visible in the client portal.
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    publishedAt: { type: Date },

    pdf: {
        data: { type: Buffer, select: false },
        size: { type: Number },
        generatedAt: { type: Date },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, required: false },
}, { timestamps: true });

clientReportSchema.index({ company: 1, createdAt: -1 });
clientReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ClientReport', clientReportSchema);
module.exports.BLOCK_TYPES = BLOCK_TYPES;
