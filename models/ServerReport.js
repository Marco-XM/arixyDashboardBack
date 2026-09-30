const mongoose = require('mongoose');

// Monthly server / VPS report for a client Company: key metrics, a check of
// the services we run for them, the fixes done in the period, and free-text
// summary/recommendations. Rendered to a branded PDF (utils/serverReportPdf.js).
//
// Once published the rendered PDF bytes are stored on the document itself so
// the client portal (arixyBackend) can serve them without a renderer of its
// own. `pdf.data` is excluded from queries by default — select('+pdf.data').

const SERVICE_STATUSES = ['operational', 'degraded', 'down', 'maintenance'];

const serverInfoSchema = new mongoose.Schema({
    label: { type: String, trim: true, default: '' },
    value: { type: String, trim: true, default: '' },
}, { _id: false });

const metricSchema = new mongoose.Schema({
    name: { type: String, trim: true, required: true },
    value: { type: Number },
    unit: { type: String, trim: true, default: '' },
    // Optional capacity ("out of"); with it — or a % unit — the PDF draws a usage bar.
    max: { type: Number },
    description: { type: String, trim: true, default: '' },
    // Shown in the "At a glance" strip on the first page.
    highlight: { type: Boolean, default: false },
}, { _id: false });

const serviceSchema = new mongoose.Schema({
    name: { type: String, trim: true, required: true },
    status: { type: String, enum: SERVICE_STATUSES, default: 'operational' },
    notes: { type: String, trim: true, default: '' },
}, { _id: false });

const fixSchema = new mongoose.Schema({
    title: { type: String, trim: true, required: true },
    description: { type: String, trim: true, default: '' },
    date: { type: Date },
}, { _id: false });

const emailLogSchema = new mongoose.Schema({
    to: [{ type: String }],
    subject: { type: String },
    sentAt: { type: Date, default: Date.now },
    sentBy: { type: mongoose.Schema.Types.ObjectId },
    sentByName: { type: String },
}, { _id: false });

const serverReportSchema = new mongoose.Schema({
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    title: { type: String, trim: true, default: 'Monthly Server Report' },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    summary: { type: String, trim: true, default: '' },
    serverInfo: { type: [serverInfoSchema], default: [] },
    metrics: { type: [metricSchema], default: [] },
    services: { type: [serviceSchema], default: [] },
    fixes: { type: [fixSchema], default: [] },
    notes: { type: String, trim: true, default: '' },

    // Only published reports are visible in the client portal.
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    publishedAt: { type: Date },

    pdf: {
        data: { type: Buffer, select: false },
        size: { type: Number },
        generatedAt: { type: Date },
    },

    emailLog: { type: [emailLogSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, required: false },
}, { timestamps: true });

serverReportSchema.index({ company: 1, periodStart: -1 });
serverReportSchema.index({ status: 1, periodStart: -1 });

module.exports = mongoose.model('ServerReport', serverReportSchema);
module.exports.SERVICE_STATUSES = SERVICE_STATUSES;
