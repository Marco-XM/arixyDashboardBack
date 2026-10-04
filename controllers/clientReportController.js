const mongoose = require('mongoose');
const ClientReport = require('../models/ClientReport');
const ReportSettings = require('../models/ReportSettings');
const Company = require('../models/Company');
const { renderClientReportPdf, reportFilename } = require('../utils/clientReportPdf');
const { sanitizeInline } = require('../utils/richText');

/* ─── input sanitising ────────────────────────────────────────────────── */

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const date = (v) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
};
const httpUrl = (v) => {
    const s = str(v, 1000);
    return /^https?:\/\//i.test(s) ? s : '';
};

// Per-type whitelist of block fields. Unknown types are dropped.
const BLOCKS = {
    heading: (b) => ({ level: b.level === 2 ? 2 : 1, text: str(b.text, 200) }),
    paragraph: (b) => ({ html: sanitizeInline(b.html), align: b.align === 'center' ? 'center' : 'left' }),
    list: (b) => ({
        style: oneOf(b.style, ['bullet', 'number', 'check'], 'bullet'),
        items: arr(b.items, 100).map(sanitizeInline),
    }),
    callout: (b) => ({
        tone: oneOf(b.tone, ['info', 'success', 'warning', 'danger'], 'info'),
        title: str(b.title, 120),
        html: sanitizeInline(b.html),
    }),
    stats: (b) => ({
        items: arr(b.items, 8).map((s) => ({
            label: str(s?.label, 60),
            value: str(s?.value, 30),
            note: str(s?.note, 140),
            tone: oneOf(s?.tone, ['neutral', 'good', 'warn', 'bad'], 'neutral'),
        })),
    }),
    table: (b) => ({
        header: b.header !== false,
        rows: arr(b.rows, 60).map((r) => arr(r, 8).map((c) => str(c, 300))),
    }),
    image: (b) => ({
        url: httpUrl(b.url),
        caption: str(b.caption, 300),
        size: oneOf(b.size, ['full', 'wide', 'medium', 'small'], 'full'),
    }),
    quote: (b) => ({ html: sanitizeInline(b.html), cite: str(b.cite, 120) }),
    actions: (b) => ({
        items: arr(b.items, 40).map((a) => ({
            title: str(a?.title, 200),
            detail: str(a?.detail, 1000),
            owner: str(a?.owner, 80),
            priority: oneOf(a?.priority, ['high', 'medium', 'low'], 'medium'),
        })),
    }),
    divider: () => ({}),
    pageBreak: () => ({}),
};

function sanitizeBlocks(blocks) {
    return arr(blocks, 300)
        .filter((b) => b && BLOCKS[b.type])
        .map((b) => ({ type: b.type, ...BLOCKS[b.type](b) }));
}

function sanitizeReport(body = {}) {
    const out = {};
    if (body.company !== undefined) out.company = body.company;
    if (body.title !== undefined) out.title = str(body.title, 160);
    if (body.subtitle !== undefined) out.subtitle = str(body.subtitle, 300);
    if (body.category !== undefined) out.category = str(body.category, 60) || 'Report';
    if (body.reportDate !== undefined) out.reportDate = date(body.reportDate);
    if (body.preparedBy !== undefined) out.preparedBy = str(body.preparedBy, 80) || 'Arixy Team';
    if (body.blocks !== undefined) out.blocks = sanitizeBlocks(body.blocks);
    return out;
}

const isTrue = (v) => v === true || v === 'true' || v === '1';

/* ─── helpers ─────────────────────────────────────────────────────────── */

async function getBranding() {
    return (await ReportSettings.getSingleton()).toObject();
}

async function getCompany(id) {
    if (!id || !mongoose.isValidObjectId(id)) return null;
    return Company.findById(id).select('name logo contactEmail').lean();
}

// Render an editor report and cache the bytes on the document (not saved here).
async function renderInto(report) {
    const [company, branding] = await Promise.all([getCompany(report.company), getBranding()]);
    const buffer = await renderClientReportPdf({ report: report.toObject(), company, branding });
    report.pdf = { data: buffer, size: buffer.length, generatedAt: new Date() };
}

// Uploads and published reports serve the stored bytes; drafts render fresh.
async function pdfFor(report) {
    const company = await getCompany(report.company);
    if ((report.source === 'upload' || report.status === 'published') && report.pdf?.data?.length) {
        return { buffer: report.pdf.data, company };
    }
    if (report.source === 'upload') return { buffer: null, company };
    const buffer = await renderClientReportPdf({ report: report.toObject(), company, branding: await getBranding() });
    return { buffer, company };
}

function filenameFor(report, company) {
    if (report.source === 'upload' && report.fileName) return report.fileName;
    return reportFilename(report, company);
}

function contentDisposition(type, filename) {
    const ascii = filename
        .normalize('NFKD')
        .replace(/[^ -~]/g, '')
        .replace(/["\\]/g, '')
        .replace(/-{2,}/g, '-') || 'report.pdf';
    return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function sendPdf(res, buffer, filename, download) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', contentDisposition(download ? 'attachment' : 'inline', filename));
    res.end(buffer);
}

// The stored bytes never go back to the browser in JSON.
function toJson(report) {
    const data = report.toObject ? report.toObject() : { ...report };
    if (data.pdf) delete data.pdf.data;
    return data;
}

const fail = (res, status, message, error) => {
    if (error) console.error(message, error);
    res.status(status).json({ success: false, message, ...(error ? { error: error.message } : {}) });
};

const isPdf = (buf) => buf && buf.length > 4 && buf.slice(0, 5).toString('latin1') === '%PDF-';

const cleanFileName = (name) => {
    const base = String(name || 'report.pdf').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 120) || 'report.pdf';
    return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
};

/* ─── CRUD ────────────────────────────────────────────────────────────── */

// GET /api/client-reports?company=&status=&source=
const listReports = async (req, res) => {
    try {
        const filter = {};
        ['company', 'status', 'source'].forEach((k) => { if (req.query[k]) filter[k] = req.query[k]; });
        const reports = await ClientReport.find(filter)
            .select('-blocks')
            .populate('company', 'name logo')
            .sort({ createdAt: -1 })
            .limit(Math.min(parseInt(req.query.limit, 10) || 200, 500))
            .lean();
        res.json({ success: true, data: reports });
    } catch (error) {
        fail(res, 500, 'Error fetching reports', error);
    }
};

const getReport = async (req, res) => {
    try {
        const report = await ClientReport.findById(req.params.id).populate('company', 'name logo contactEmail').lean();
        if (!report) return fail(res, 404, 'Report not found');
        res.json({ success: true, data: report });
    } catch (error) {
        fail(res, 500, 'Error fetching report', error);
    }
};

const createReport = async (req, res) => {
    try {
        const input = sanitizeReport(req.body);
        if (!input.company || !(await getCompany(input.company))) return fail(res, 400, 'Choose a client company');
        if (!input.title) return fail(res, 400, 'Give the report a title');

        const report = new ClientReport({ ...input, source: 'editor', createdBy: req.user?._id });
        if (isTrue(req.body.publish)) {
            report.status = 'published';
            report.publishedAt = new Date();
            await renderInto(report);
        }
        await report.save();
        res.status(201).json({ success: true, message: 'Report created', data: toJson(report) });
    } catch (error) {
        fail(res, 500, 'Error creating report', error);
    }
};

// PUT /api/client-reports/:id — a published editor report is re-rendered so
// the portal always serves the current content.
const updateReport = async (req, res) => {
    try {
        const report = await ClientReport.findById(req.params.id);
        if (!report) return fail(res, 404, 'Report not found');
        const input = sanitizeReport(req.body);
        if (report.source === 'upload') delete input.blocks;
        if (input.company !== undefined && !(await getCompany(input.company))) return fail(res, 400, 'Choose a client company');
        if (input.title !== undefined && !input.title) return fail(res, 400, 'Give the report a title');
        report.set(input);

        if (isTrue(req.body.publish) && report.status !== 'published') {
            report.status = 'published';
            report.publishedAt = new Date();
        }
        if (report.status === 'published' && report.source === 'editor') await renderInto(report);
        await report.save();
        res.json({ success: true, message: 'Report saved', data: toJson(report) });
    } catch (error) {
        fail(res, 500, 'Error saving report', error);
    }
};

const deleteReport = async (req, res) => {
    try {
        const report = await ClientReport.findByIdAndDelete(req.params.id);
        if (!report) return fail(res, 404, 'Report not found');
        res.json({ success: true, message: 'Report deleted' });
    } catch (error) {
        fail(res, 500, 'Error deleting report', error);
    }
};

/* ─── publishing ──────────────────────────────────────────────────────── */

// Also refreshes the client's copy after branding/logo changes.
const publishReport = async (req, res) => {
    try {
        const report = await ClientReport.findById(req.params.id).select('+pdf.data');
        if (!report) return fail(res, 404, 'Report not found');
        if (report.source === 'upload' && !report.pdf?.data?.length) return fail(res, 400, 'Upload the PDF file first');
        if (report.status !== 'published') report.publishedAt = new Date();
        report.status = 'published';
        if (report.source === 'editor') await renderInto(report);
        await report.save();
        res.json({ success: true, message: 'Report published to the client portal', data: toJson(report) });
    } catch (error) {
        fail(res, 500, 'Error publishing report', error);
    }
};

const unpublishReport = async (req, res) => {
    try {
        const report = await ClientReport.findById(req.params.id);
        if (!report) return fail(res, 404, 'Report not found');
        report.status = 'draft';
        // An uploaded file is the report itself — keep it.
        if (report.source === 'editor') report.pdf = undefined;
        await report.save();
        res.json({ success: true, message: 'Report hidden from the client portal', data: toJson(report) });
    } catch (error) {
        fail(res, 500, 'Error unpublishing report', error);
    }
};

/* ─── PDFs ────────────────────────────────────────────────────────────── */

// POST /api/client-reports/preview — render unsaved editor content.
const previewReport = async (req, res) => {
    try {
        const input = sanitizeReport(req.body);
        const [company, branding] = await Promise.all([getCompany(input.company), getBranding()]);
        const buffer = await renderClientReportPdf({
            report: { ...input, title: input.title || 'Untitled report', publishedAt: req.body.publishedAt || null },
            company: company || { name: 'Client name' },
            branding,
        });
        sendPdf(res, buffer, 'preview.pdf', false);
    } catch (error) {
        fail(res, 500, 'Error rendering preview', error);
    }
};

// GET /api/client-reports/:id/pdf[?download=1]
const downloadReportPdf = async (req, res) => {
    try {
        const report = await ClientReport.findById(req.params.id).select('+pdf.data');
        if (!report) return fail(res, 404, 'Report not found');
        const { buffer, company } = await pdfFor(report);
        if (!buffer) return fail(res, 404, 'No PDF has been uploaded for this report');
        sendPdf(res, buffer, filenameFor(report, company), req.query.download === '1');
    } catch (error) {
        fail(res, 500, 'Error rendering report PDF', error);
    }
};

/* ─── uploaded PDFs ───────────────────────────────────────────────────── */

// POST /api/client-reports/upload — multipart: file + company, title,
// subtitle, category, reportDate, preparedBy, publish.
const uploadReport = async (req, res) => {
    try {
        if (!req.file || !isPdf(req.file.buffer)) return fail(res, 400, 'Choose a PDF file');
        const input = sanitizeReport(req.body);
        delete input.blocks;
        if (!input.company || !(await getCompany(input.company))) return fail(res, 400, 'Choose a client company');
        const fileName = cleanFileName(req.file.originalname);
        const report = new ClientReport({
            ...input,
            title: input.title || fileName.replace(/\.pdf$/i, ''),
            source: 'upload',
            fileName,
            pdf: { data: req.file.buffer, size: req.file.size, generatedAt: new Date() },
            createdBy: req.user?._id,
        });
        if (isTrue(req.body.publish)) {
            report.status = 'published';
            report.publishedAt = new Date();
        }
        await report.save();
        res.status(201).json({ success: true, message: 'Report uploaded', data: toJson(report) });
    } catch (error) {
        fail(res, 500, 'Error uploading report', error);
    }
};

// PUT /api/client-reports/:id/file — replace an uploaded report's PDF.
const replaceReportFile = async (req, res) => {
    try {
        if (!req.file || !isPdf(req.file.buffer)) return fail(res, 400, 'Choose a PDF file');
        const report = await ClientReport.findById(req.params.id);
        if (!report) return fail(res, 404, 'Report not found');
        if (report.source !== 'upload') return fail(res, 400, 'Only uploaded reports have a file to replace');
        report.fileName = cleanFileName(req.file.originalname);
        report.pdf = { data: req.file.buffer, size: req.file.size, generatedAt: new Date() };
        await report.save();
        res.json({ success: true, message: 'PDF replaced', data: toJson(report) });
    } catch (error) {
        fail(res, 500, 'Error replacing the PDF', error);
    }
};

module.exports = {
    listReports,
    getReport,
    createReport,
    updateReport,
    deleteReport,
    publishReport,
    unpublishReport,
    previewReport,
    downloadReportPdf,
    uploadReport,
    replaceReportFile,
};
