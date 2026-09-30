const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const ServerReport = require('../models/ServerReport');
const ReportSettings = require('../models/ReportSettings');
const Company = require('../models/Company');
const { cloudinary } = require('./cloudinary');
const { renderServerReportPdf, loadBrandLogo, reportFilename } = require('../utils/serverReportPdf');
const { buildReportEmail, defaultReportMessage, defaultReportSubject } = require('../utils/serverReportEmail');
const { findEmailConfig, transporterFromConfig } = require('../utils/mailer');

const { SERVICE_STATUSES } = ServerReport;

/* ─── input sanitising ────────────────────────────────────────────────── */

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v));
const date = (v) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
};

// Whitelist + coerce the editable fields. Template rows the editor pre-fills
// (e.g. server-info labels) are kept while any part is filled in; the PDF
// skips rows that are incomplete.
function sanitizeReport(body = {}) {
    const out = {};
    if (body.company !== undefined) out.company = body.company;
    if (body.title !== undefined) out.title = str(body.title, 120) || 'Monthly Server Report';
    if (body.periodStart !== undefined) out.periodStart = date(body.periodStart);
    if (body.periodEnd !== undefined) out.periodEnd = date(body.periodEnd);
    if (body.summary !== undefined) out.summary = str(body.summary, 20000);
    if (body.notes !== undefined) out.notes = str(body.notes, 20000);
    if (Array.isArray(body.serverInfo)) {
        out.serverInfo = body.serverInfo
            .map((i) => ({ label: str(i?.label, 80), value: str(i?.value, 300) }))
            .filter((i) => i.label || i.value)
            .slice(0, 30);
    }
    if (Array.isArray(body.metrics)) {
        out.metrics = body.metrics
            .map((m) => ({
                name: str(m?.name, 120),
                value: num(m?.value),
                unit: str(m?.unit, 20),
                max: num(m?.max),
                description: str(m?.description, 1000),
                highlight: !!m?.highlight,
            }))
            .filter((m) => m.name)
            .slice(0, 60);
    }
    if (Array.isArray(body.services)) {
        out.services = body.services
            .map((s) => ({
                name: str(s?.name, 120),
                status: SERVICE_STATUSES.includes(s?.status) ? s.status : 'operational',
                notes: str(s?.notes, 500),
            }))
            .filter((s) => s.name)
            .slice(0, 100);
    }
    if (Array.isArray(body.fixes)) {
        out.fixes = body.fixes
            .map((f) => ({ title: str(f?.title, 200), description: str(f?.description, 3000), date: date(f?.date) }))
            .filter((f) => f.title)
            .slice(0, 100);
    }
    return out;
}

function validatePeriod(report) {
    if (!report.periodStart || !report.periodEnd) return 'Reporting period start and end dates are required';
    if (new Date(report.periodStart) > new Date(report.periodEnd)) return 'The period start date must be on or before the end date';
    return null;
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

async function getBranding() {
    return (await ReportSettings.getSingleton()).toObject();
}

async function getCompany(id) {
    if (!id || !mongoose.isValidObjectId(id)) return null;
    return Company.findById(id).select('name logo contactEmail').lean();
}

// Render the report and cache the bytes on the document (not saved here).
async function renderInto(report) {
    const [company, branding] = await Promise.all([getCompany(report.company), getBranding()]);
    const buffer = await renderServerReportPdf({ report: report.toObject(), company, branding });
    report.pdf = { data: buffer, size: buffer.length, generatedAt: new Date() };
    return { buffer, company };
}

// Published reports serve the stored copy (exactly what the client has);
// drafts are rendered fresh.
async function pdfFor(report) {
    if (report.status === 'published' && report.pdf?.data?.length) {
        return { buffer: report.pdf.data, company: await getCompany(report.company) };
    }
    const [company, branding] = await Promise.all([getCompany(report.company), getBranding()]);
    const buffer = await renderServerReportPdf({ report: report.toObject(), company, branding });
    return { buffer, company };
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

const fail = (res, status, message, error) => {
    if (error) console.error(message, error);
    res.status(status).json({ success: false, message, ...(error ? { error: error.message } : {}) });
};

/* ─── CRUD ────────────────────────────────────────────────────────────── */

// GET /api/server-reports?company=&status=
const listReports = async (req, res) => {
    try {
        const { company, status } = req.query;
        const filter = {};
        if (company) filter.company = company;
        if (status) filter.status = status;
        const reports = await ServerReport.find(filter)
            .populate('company', 'name logo')
            .sort({ periodStart: -1, createdAt: -1 })
            .limit(Math.min(parseInt(req.query.limit, 10) || 200, 500))
            .lean();
        res.json({ success: true, data: reports });
    } catch (error) {
        fail(res, 500, 'Error fetching reports', error);
    }
};

const getReport = async (req, res) => {
    try {
        const report = await ServerReport.findById(req.params.id).populate('company', 'name logo contactEmail').lean();
        if (!report) return fail(res, 404, 'Report not found');
        res.json({ success: true, data: report });
    } catch (error) {
        fail(res, 500, 'Error fetching report', error);
    }
};

// GET /api/server-reports/previous?company=&exclude= — the company's latest
// report, used to pre-fill a new one (same services, metrics, server info).
const getPreviousReport = async (req, res) => {
    try {
        const { company, exclude } = req.query;
        if (!company || !mongoose.isValidObjectId(company)) return res.json({ success: true, data: null });
        const filter = { company };
        if (exclude && mongoose.isValidObjectId(exclude)) filter._id = { $ne: exclude };
        const report = await ServerReport.findOne(filter).sort({ periodStart: -1, createdAt: -1 }).lean();
        res.json({ success: true, data: report || null });
    } catch (error) {
        fail(res, 500, 'Error fetching previous report', error);
    }
};

const createReport = async (req, res) => {
    try {
        const input = sanitizeReport(req.body);
        if (!input.company || !(await getCompany(input.company))) return fail(res, 400, 'Choose a client company');
        const periodError = validatePeriod(input);
        if (periodError) return fail(res, 400, periodError);

        const report = new ServerReport({ ...input, createdBy: req.user?._id });
        if (req.body.publish) {
            report.status = 'published';
            report.publishedAt = new Date();
            await renderInto(report);
        }
        await report.save();
        const data = report.toObject();
        delete data.pdf?.data;
        res.status(201).json({ success: true, message: 'Report created', data });
    } catch (error) {
        fail(res, 500, 'Error creating report', error);
    }
};

// PUT /api/server-reports/:id — a published report's stored PDF is re-rendered
// so the client portal always serves the current content.
const updateReport = async (req, res) => {
    try {
        const report = await ServerReport.findById(req.params.id);
        if (!report) return fail(res, 404, 'Report not found');
        const input = sanitizeReport(req.body);
        if (input.company !== undefined && !(await getCompany(input.company))) return fail(res, 400, 'Choose a client company');
        report.set(input);
        const periodError = validatePeriod(report);
        if (periodError) return fail(res, 400, periodError);

        if (req.body.publish && report.status !== 'published') {
            report.status = 'published';
            report.publishedAt = new Date();
        }
        if (report.status === 'published') await renderInto(report);
        await report.save();
        const data = report.toObject();
        delete data.pdf?.data;
        res.json({ success: true, message: 'Report saved', data });
    } catch (error) {
        fail(res, 500, 'Error saving report', error);
    }
};

const deleteReport = async (req, res) => {
    try {
        const report = await ServerReport.findByIdAndDelete(req.params.id);
        if (!report) return fail(res, 404, 'Report not found');
        res.json({ success: true, message: 'Report deleted' });
    } catch (error) {
        fail(res, 500, 'Error deleting report', error);
    }
};

/* ─── publishing ──────────────────────────────────────────────────────── */

// Also used to refresh the client's copy after branding/logo changes.
const publishReport = async (req, res) => {
    try {
        const report = await ServerReport.findById(req.params.id);
        if (!report) return fail(res, 404, 'Report not found');
        const periodError = validatePeriod(report);
        if (periodError) return fail(res, 400, periodError);
        if (report.status !== 'published') report.publishedAt = new Date();
        report.status = 'published';
        await renderInto(report);
        await report.save();
        const data = report.toObject();
        delete data.pdf?.data;
        res.json({ success: true, message: 'Report published to the client portal', data });
    } catch (error) {
        fail(res, 500, 'Error publishing report', error);
    }
};

const unpublishReport = async (req, res) => {
    try {
        const report = await ServerReport.findById(req.params.id);
        if (!report) return fail(res, 404, 'Report not found');
        report.status = 'draft';
        report.pdf = undefined;
        await report.save();
        res.json({ success: true, message: 'Report hidden from the client portal', data: report.toObject() });
    } catch (error) {
        fail(res, 500, 'Error unpublishing report', error);
    }
};

/* ─── PDFs ────────────────────────────────────────────────────────────── */

// POST /api/server-reports/preview — render unsaved editor content.
const previewReport = async (req, res) => {
    try {
        const input = sanitizeReport(req.body);
        const periodError = validatePeriod(input);
        if (periodError) return fail(res, 400, periodError);
        const [company, branding] = await Promise.all([getCompany(input.company), getBranding()]);
        const report = new ServerReport({ ...input, company: company?._id || new mongoose.Types.ObjectId() });
        const buffer = await renderServerReportPdf({
            report: { ...report.toObject(), publishedAt: req.body.publishedAt || null },
            company: company || { name: 'Client name' },
            branding,
        });
        sendPdf(res, buffer, 'preview.pdf', false);
    } catch (error) {
        fail(res, 500, 'Error rendering preview', error);
    }
};

// GET /api/server-reports/:id/pdf[?download=1]
const downloadReportPdf = async (req, res) => {
    try {
        const report = await ServerReport.findById(req.params.id).select('+pdf.data');
        if (!report) return fail(res, 404, 'Report not found');
        const { buffer, company } = await pdfFor(report);
        sendPdf(res, buffer, reportFilename(report, company), req.query.download === '1');
    } catch (error) {
        fail(res, 500, 'Error rendering report PDF', error);
    }
};

/* ─── email ───────────────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

// GET /api/server-reports/:id/email-defaults — suggested recipients (company
// contact + active portal users), subject and message for the send dialog.
const getEmailDefaults = async (req, res) => {
    try {
        const report = await ServerReport.findById(req.params.id).lean();
        if (!report) return fail(res, 404, 'Report not found');
        const CompanyUser = require('../models/CompanyUser');
        const [company, branding, users] = await Promise.all([
            getCompany(report.company),
            getBranding(),
            CompanyUser.find({ company: report.company, status: 'active' }).select('name email role').lean(),
        ]);
        const recipients = [];
        const seen = new Set();
        const add = (email, name, source) => {
            const e = String(email || '').trim().toLowerCase();
            if (!e || seen.has(e)) return;
            seen.add(e);
            recipients.push({ email: e, name, source });
        };
        add(company?.contactEmail, company?.name, 'Company contact');
        users.forEach((u) => add(u.email, u.name, `Portal user · ${u.role}`));
        res.json({
            success: true,
            data: {
                recipients,
                subject: defaultReportSubject({ report, company }),
                message: defaultReportMessage({ report, company, branding }),
            },
        });
    } catch (error) {
        fail(res, 500, 'Error loading email defaults', error);
    }
};

// POST /api/server-reports/:id/email { to[], subject, message, configId?, bccMe? }
// Sends from the user's configured mailbox with the PDF attached. A draft is
// published first so the "View in client portal" link works.
const emailReport = async (req, res) => {
    try {
        const to = [...new Set((Array.isArray(req.body.to) ? req.body.to : [])
            .map((e) => String(e || '').trim().toLowerCase())
            .filter(Boolean))];
        if (!to.length) return fail(res, 400, 'Add at least one recipient');
        const invalid = to.filter((e) => !EMAIL_RE.test(e));
        if (invalid.length) return fail(res, 400, `Invalid email address: ${invalid.join(', ')}`);
        if (to.length > 25) return fail(res, 400, 'Too many recipients (max 25)');

        const emailConfig = await findEmailConfig(req.user._id, req.body.configId || null);
        if (!emailConfig) {
            return fail(res, 400, 'No sending mailbox is set up. Add one under Marketing → Email settings first.');
        }

        const report = await ServerReport.findById(req.params.id).select('+pdf.data');
        if (!report) return fail(res, 404, 'Report not found');
        const periodError = validatePeriod(report);
        if (periodError) return fail(res, 400, periodError);

        if (report.status !== 'published' || !report.pdf?.data?.length) {
            if (report.status !== 'published') report.publishedAt = new Date();
            report.status = 'published';
            await renderInto(report);
        }
        const [company, branding] = await Promise.all([getCompany(report.company), getBranding()]);
        const brandLogo = await loadBrandLogo(branding);
        const filename = reportFilename(report, company);
        const subject = str(req.body.subject, 200) || defaultReportSubject({ report, company });
        const { html, text } = buildReportEmail({
            report: report.toObject(),
            company,
            branding,
            message: str(req.body.message, 10000),
            filename,
        });

        await transporterFromConfig(emailConfig).sendMail({
            from: { name: emailConfig.senderName, address: emailConfig.senderEmail },
            to,
            ...(req.body.bccMe ? { bcc: emailConfig.senderEmail } : {}),
            ...(branding.email ? { replyTo: branding.email } : {}),
            subject,
            html,
            text,
            attachments: [
                { filename, content: report.pdf.data, contentType: 'application/pdf' },
                { filename: `logo.${brandLogo.format === 'jpg' ? 'jpg' : 'png'}`, content: brandLogo.data, cid: 'brand-logo' },
            ],
        });

        report.emailLog.push({
            to,
            subject,
            sentAt: new Date(),
            sentBy: req.user?._id,
            sentByName: req.user?.name || req.user?.username || '',
        });
        await report.save();
        const data = report.toObject();
        delete data.pdf?.data;
        res.json({ success: true, message: `Report emailed to ${to.join(', ')}`, data });
    } catch (error) {
        fail(res, 500, `Could not send the email: ${error.message}`, error);
    }
};

/* ─── branding ────────────────────────────────────────────────────────── */

let defaultLogoDataUrl = null;
function getDefaultLogoDataUrl() {
    if (!defaultLogoDataUrl) {
        const buf = fs.readFileSync(path.join(__dirname, '..', 'assets', 'arixy-logo.png'));
        defaultLogoDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    }
    return defaultLogoDataUrl;
}

const getBrandingSettings = async (req, res) => {
    try {
        res.json({ success: true, data: { ...(await getBranding()), defaultLogo: getDefaultLogoDataUrl() } });
    } catch (error) {
        fail(res, 500, 'Error loading report branding', error);
    }
};

// PUT /api/server-reports/branding — multipart (optional "logo" file) or JSON.
const updateBrandingSettings = async (req, res) => {
    try {
        const settings = await ReportSettings.getSingleton();
        const b = req.body || {};
        if (b.brandName !== undefined) settings.brandName = str(b.brandName, 80) || 'Arixy Tech';
        ['website', 'email', 'phone', 'portalUrl'].forEach((k) => {
            if (b[k] !== undefined) settings[k] = str(b[k], 200);
        });
        if (b.accentColor !== undefined) {
            const c = str(b.accentColor, 7);
            if (!/^#[0-9a-f]{6}$/i.test(c)) return fail(res, 400, 'Accent colour must be a hex value like #4F46E5');
            settings.accentColor = c;
        }

        const oldPublicId = settings.logoPublicId;
        if (req.file) {
            settings.logoUrl = req.file.path;
            settings.logoPublicId = req.file.filename;
        } else if (b.removeLogo === true || b.removeLogo === 'true') {
            settings.logoUrl = '';
            settings.logoPublicId = '';
        }
        await settings.save();
        if (oldPublicId && oldPublicId !== settings.logoPublicId) {
            cloudinary.uploader.destroy(oldPublicId).catch(() => {});
        }
        res.json({ success: true, message: 'Report branding saved', data: { ...settings.toObject(), defaultLogo: getDefaultLogoDataUrl() } });
    } catch (error) {
        fail(res, 500, 'Error saving report branding', error);
    }
};

module.exports = {
    listReports,
    getReport,
    getPreviousReport,
    createReport,
    updateReport,
    deleteReport,
    publishReport,
    unpublishReport,
    previewReport,
    downloadReportPdf,
    getEmailDefaults,
    emailReport,
    getBrandingSettings,
    updateBrandingSettings,
};
