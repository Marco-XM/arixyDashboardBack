const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const Company = require('../models/Company');
const InvoiceCounter = require('../models/InvoiceCounter');
const ReportSettings = require('../models/ReportSettings');
const { renderInvoicePdf, invoiceFilename } = require('../utils/invoicePdf');
const fx = require('../utils/fx');
const mongoose = require('mongoose');

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// Keep line items that name a product/service or describe one.
function sanitizeLineItems(items) {
    return (Array.isArray(items) ? items : []).slice(0, 100)
        .map((li) => ({
            name: str(li?.name, 200),
            description: str(li?.description, 2000),
            quantity: Math.max(0, num(li?.quantity, 1)),
            unitPrice: Math.max(0, num(li?.unitPrice, 0)),
        }))
        .filter((li) => li.name || li.description);
}

const nextInvoiceNumber = () => InvoiceCounter.next(new Date().getUTCFullYear());

/* --------------------------------- PDFs ---------------------------------- */

const getCompany = (id) => (id && mongoose.isValidObjectId(String(id))
    ? Company.findById(id).select('name logo contactEmail phone address').lean()
    : null);
const getBranding = async () => (await ReportSettings.getSingleton()).toObject();

async function renderFor(invoice) {
    const [company, branding, amountPaid] = await Promise.all([
        getCompany(invoice.company?._id || invoice.company),
        getBranding(),
        invoice._id ? amountPaidFor(invoice._id) : 0,
    ]);
    const buffer = await renderInvoicePdf({ invoice, company, branding, amountPaid });
    return { buffer, company };
}

// Re-render the stored copy the client downloads from the portal. A render
// failure must not undo the change that triggered it, so it is only logged.
async function refreshPdf(invoiceId) {
    try {
        const invoice = await Invoice.findById(invoiceId).lean();
        if (!invoice) return;
        const { buffer } = await renderFor(invoice);
        await Invoice.updateOne({ _id: invoiceId }, { $set: { pdf: { data: buffer, size: buffer.length, generatedAt: new Date() } } });
    } catch (err) {
        console.error('Invoice PDF render failed for', String(invoiceId), err);
    }
}

function sendPdf(res, buffer, filename, download) {
    const ascii = filename.normalize('NFKD').replace(/[^ -~]/g, '').replace(/["\\]/g, '').replace(/-{2,}/g, '-') || 'invoice.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.end(buffer);
}

// Sum of payments recorded against an invoice.
async function amountPaidFor(invoiceId) {
    const rows = await Payment.aggregate([
        { $match: { invoice: new mongoose.Types.ObjectId(String(invoiceId)) } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return rows[0]?.total || 0;
}

// Derive invoice status from amount paid vs total and the due date.
function deriveStatus(invoice, amountPaid) {
    if (invoice.status === 'void') return 'void';
    if (invoice.total > 0 && amountPaid >= invoice.total) return 'paid';
    if (amountPaid > 0) return 'partial';
    if (invoice.dueDate && new Date(invoice.dueDate) < new Date()) return 'overdue';
    return invoice.status === 'draft' ? 'draft' : 'sent';
}

/* ------------------------------- Invoices -------------------------------- */

const getAllInvoices = async (req, res) => {
    try {
        const { company, status, type, page = 1, limit = 20 } = req.query;
        const filter = {};
        if (company) filter.company = company;
        if (status) filter.status = status;
        if (type) filter.type = type;

        const skip = (page - 1) * limit;
        const [invoices, total] = await Promise.all([
            Invoice.find(filter).populate('company', 'name').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
            Invoice.countDocuments(filter),
        ]);

        // Attach amountPaid per invoice.
        const ids = invoices.map((i) => i._id);
        const paid = await Payment.aggregate([
            { $match: { invoice: { $in: ids } } },
            { $group: { _id: '$invoice', total: { $sum: '$amount' } } },
        ]);
        const paidMap = paid.reduce((m, p) => { m[p._id.toString()] = p.total; return m; }, {});
        const data = invoices.map((inv) => ({ ...inv.toObject(), amountPaid: paidMap[inv._id.toString()] || 0 }));

        res.json({
            success: true,
            data,
            pagination: { currentPage: parseInt(page), totalPages: Math.ceil(total / limit), total, limit: parseInt(limit) },
        });
    } catch (error) {
        console.error('Error fetching invoices:', error);
        res.status(500).json({ success: false, message: 'Error fetching invoices', error: error.message });
    }
};

const getInvoiceById = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id).populate('company', 'name logo').populate('subscription');
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        const payments = await Payment.find({ invoice: invoice._id }).sort({ paidAt: -1 });
        const amountPaid = payments.reduce((s, p) => s + p.amount, 0);
        res.json({ success: true, data: { ...invoice.toObject(), amountPaid, payments } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching invoice', error: error.message });
    }
};

const createInvoice = async (req, res) => {
    try {
        const { number, company, subscription, document, type, lineItems, tax, currency, status, issueDate, dueDate, period, notes, visibleToClient } = req.body;
        if (!company) return res.status(400).json({ success: false, message: 'Company is required' });

        const items = sanitizeLineItems(lineItems);
        if (!items.length) return res.status(400).json({ success: false, message: 'Add at least one product or service' });

        const invoice = new Invoice({
            number: str(number, 40) || await nextInvoiceNumber(),
            company, subscription: subscription || undefined, document: document || undefined,
            type: type || 'project',
            lineItems: items,
            tax: Number(tax || 0), currency: currency || 'USD',
            status: status || 'draft',
            issueDate: issueDate || Date.now(), dueDate: dueDate || undefined,
            period: period || undefined, notes: notes || '',
            visibleToClient: visibleToClient !== false,
            createdBy: req.user?._id,
        });
        await invoice.save();
        await refreshPdf(invoice._id);
        res.status(201).json({ success: true, message: 'Invoice created', data: invoice });
    } catch (error) {
        console.error('Error creating invoice:', error);
        res.status(500).json({ success: false, message: 'Error creating invoice', error: error.message });
    }
};

// Build a recurring maintenance invoice from a subscription + period.
const createFromSubscription = async (req, res) => {
    try {
        const { subscriptionId, month, year, dueDate, visibleToClient } = req.body;
        const sub = await Subscription.findById(subscriptionId).populate('service', 'name description');
        if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });

        const serviceName = sub.serviceName || sub.service?.name || 'Service';
        const monthName = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(month)] || '';
        const invoice = new Invoice({
            number: await nextInvoiceNumber(),
            company: sub.company,
            subscription: sub._id,
            type: 'maintenance',
            lineItems: [{
                name: serviceName,
                description: [monthName ? `${monthName} ${year}` : '', sub.service?.description || ''].filter(Boolean).join(' — '),
                quantity: 1,
                unitPrice: sub.price?.amount || 0,
            }],
            currency: sub.price?.currency || 'USD',
            status: 'draft',
            period: month ? { month: Number(month), year: Number(year) } : undefined,
            dueDate: dueDate || undefined,
            visibleToClient: visibleToClient !== false,
            createdBy: req.user?._id,
        });
        await invoice.save();
        await refreshPdf(invoice._id);
        res.status(201).json({ success: true, message: 'Maintenance invoice created', data: invoice });
    } catch (error) {
        console.error('Error creating invoice from subscription:', error);
        res.status(500).json({ success: false, message: 'Error creating invoice', error: error.message });
    }
};

const updateInvoice = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        const fields = ['number', 'company', 'subscription', 'document', 'type', 'lineItems', 'tax', 'currency', 'status', 'issueDate', 'dueDate', 'period', 'notes', 'visibleToClient'];
        fields.forEach((f) => { if (req.body[f] !== undefined) invoice[f] = req.body[f]; });
        if (req.body.lineItems !== undefined) {
            invoice.lineItems = sanitizeLineItems(req.body.lineItems);
            if (!invoice.lineItems.length) return res.status(400).json({ success: false, message: 'Add at least one product or service' });
        }
        if (req.body.tax !== undefined) invoice.tax = num(req.body.tax);
        if (!invoice.number) invoice.number = await nextInvoiceNumber();
        // Re-derive status from payments (against the new total) unless the
        // admin set it explicitly.
        if (req.body.status === undefined && invoice.status !== 'draft') {
            const total = invoice.lineItems.reduce((t, li) => t + li.quantity * li.unitPrice, 0) + Number(invoice.tax || 0);
            invoice.status = deriveStatus({ status: invoice.status === 'paid' ? 'sent' : invoice.status, total, dueDate: invoice.dueDate }, await amountPaidFor(invoice._id));
            if (invoice.status !== 'paid') invoice.paidDate = undefined;
        }
        await invoice.save();
        await refreshPdf(invoice._id);
        res.json({ success: true, message: 'Invoice updated', data: invoice });
    } catch (error) {
        console.error('Error updating invoice:', error);
        res.status(500).json({ success: false, message: 'Error updating invoice', error: error.message });
    }
};

// Show or hide an invoice in the client portal. Only touches the flag, so the
// totals recomputed on save are left alone.
const setInvoiceVisibility = async (req, res) => {
    try {
        if (typeof req.body.visibleToClient !== 'boolean') {
            return res.status(400).json({ success: false, message: 'visibleToClient must be true or false' });
        }
        const invoice = await Invoice.findByIdAndUpdate(
            req.params.id,
            { $set: { visibleToClient: req.body.visibleToClient } },
            { new: true },
        );
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        res.json({ success: true, message: invoice.visibleToClient ? 'Invoice shown to client' : 'Invoice hidden from client', data: invoice });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error updating invoice visibility', error: error.message });
    }
};

const deleteInvoice = async (req, res) => {
    try {
        const invoice = await Invoice.findByIdAndDelete(req.params.id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        await Payment.deleteMany({ invoice: invoice._id });
        res.json({ success: true, message: 'Invoice deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting invoice', error: error.message });
    }
};

// GET /api/finance/invoices/:id/pdf[?download=1] — rendered fresh so it
// always reflects the current payments.
const getInvoicePdf = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id).lean();
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        const { buffer, company } = await renderFor(invoice);
        sendPdf(res, buffer, invoiceFilename(invoice, company), req.query.download === '1');
    } catch (error) {
        console.error('Error rendering invoice PDF:', error);
        res.status(500).json({ success: false, message: 'Error rendering invoice PDF', error: error.message });
    }
};

// POST /api/finance/invoices/preview — render the unsaved form.
const previewInvoice = async (req, res) => {
    try {
        const b = req.body || {};
        const lineItems = sanitizeLineItems(b.lineItems).map((li) => ({ ...li, amount: li.quantity * li.unitPrice }));
        const subtotal = lineItems.reduce((t, li) => t + li.amount, 0);
        const total = subtotal + num(b.tax);
        const invoice = {
            _id: mongoose.isValidObjectId(String(b._id || '')) ? b._id : undefined,
            number: str(b.number, 40) || 'INV-PREVIEW',
            company: b.company,
            type: b.type || 'project',
            lineItems, subtotal, tax: num(b.tax), total,
            currency: str(b.currency, 8) || 'EGP',
            status: total === 0 ? 'paid' : (b.status || 'sent'),
            issueDate: b.issueDate || new Date(),
            dueDate: b.dueDate || undefined,
            period: b.period,
            notes: str(b.notes, 4000),
        };
        const { buffer } = await renderFor(invoice);
        sendPdf(res, buffer, 'invoice-preview.pdf', false);
    } catch (error) {
        console.error('Error rendering invoice preview:', error);
        res.status(500).json({ success: false, message: 'Error rendering preview', error: error.message });
    }
};

// GET/PUT /api/finance/invoice-settings — payment details + closing note
// printed on invoices (logo, name and colours come from report branding).
const getInvoiceSettings = async (req, res) => {
    try {
        const s = await getBranding();
        res.json({ success: true, data: { invoicePaymentDetails: s.invoicePaymentDetails || '', invoiceNote: s.invoiceNote || '' } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error loading invoice settings', error: error.message });
    }
};

const updateInvoiceSettings = async (req, res) => {
    try {
        const settings = await ReportSettings.getSingleton();
        if (req.body.invoicePaymentDetails !== undefined) settings.invoicePaymentDetails = str(req.body.invoicePaymentDetails, 2000);
        if (req.body.invoiceNote !== undefined) settings.invoiceNote = str(req.body.invoiceNote, 300);
        await settings.save();
        // Unpaid invoices print the payment details, so refresh their PDFs.
        const unpaid = await Invoice.find({ status: { $in: ['sent', 'partial', 'overdue'] } }).select('_id').lean();
        for (const inv of unpaid) await refreshPdf(inv._id); // eslint-disable-line no-await-in-loop
        res.json({ success: true, message: 'Invoice settings saved', data: { invoicePaymentDetails: settings.invoicePaymentDetails, invoiceNote: settings.invoiceNote } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error saving invoice settings', error: error.message });
    }
};

/* ------------------------------- Payments -------------------------------- */

const recordPayment = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

        const { amount, method, reference, paidAt, notes } = req.body;
        if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: 'A positive amount is required' });

        await Payment.create({
            invoice: invoice._id, company: invoice.company, amount: Number(amount),
            currency: invoice.currency, method: method || 'bank', reference: reference || '',
            paidAt: paidAt || Date.now(), notes: notes || '', recordedBy: req.user?._id,
        });

        const amountPaid = await amountPaidFor(invoice._id);
        invoice.status = deriveStatus(invoice, amountPaid);
        if (invoice.status === 'paid' && !invoice.paidDate) invoice.paidDate = new Date();
        await invoice.save();
        await refreshPdf(invoice._id);

        res.json({ success: true, message: 'Payment recorded', data: { invoice, amountPaid } });
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({ success: false, message: 'Error recording payment', error: error.message });
    }
};

/* ------------------------------- Summary --------------------------------- */

// GET /api/finance/summary?currency=EGP[&company=] — totals converted into
// one currency at today's exchange rates.
const getSummary = async (req, res) => {
    try {
        const { company } = req.query;
        const currency = str(req.query.currency, 8).toUpperCase() || 'EGP';
        const match = company ? { company: new mongoose.Types.ObjectId(String(company)) } : {};

        const [byStatus, paidAgg] = await Promise.all([
            Invoice.aggregate([{ $match: match }, { $group: { _id: { status: '$status', currency: '$currency' }, count: { $sum: 1 }, total: { $sum: '$total' } } }]),
            Payment.aggregate([{ $match: match }, { $group: { _id: '$currency', collected: { $sum: '$amount' } } }]),
        ]);

        const foreign = [...byStatus.map((r) => r._id.currency), ...paidAgg.map((r) => r._id)].some((c) => c && c.toUpperCase() !== currency);
        const latest = foreign ? await fx.getLatest().catch(() => null) : null;
        const unconverted = new Set();
        const conv = (amount, cur) => {
            const c = String(cur || currency).toUpperCase();
            const v = c === currency ? amount : fx.convert(amount, c, currency, latest?.rates);
            if (v === null) { unconverted.add(c); return 0; }
            return v;
        };

        const statuses = {};
        let invoiced = 0;
        let invoiceCount = 0;
        byStatus.forEach((r) => {
            const v = conv(r.total, r._id.currency);
            invoiced += v;
            invoiceCount += r.count;
            const s = statuses[r._id.status] || (statuses[r._id.status] = { count: 0, total: 0 });
            s.count += r.count;
            s.total += v;
        });
        const collected = paidAgg.reduce((t, r) => t + conv(r.collected, r._id), 0);

        res.json({
            success: true,
            data: {
                currency,
                invoiced,
                collected,
                outstanding: Math.max(0, invoiced - collected),
                invoiceCount,
                byStatus: statuses,
                unconverted: [...unconverted],
            },
        });
    } catch (error) {
        console.error('Error fetching finance summary:', error);
        res.status(500).json({ success: false, message: 'Error fetching summary', error: error.message });
    }
};

module.exports = {
    getAllInvoices, getInvoiceById, createInvoice, createFromSubscription,
    updateInvoice, setInvoiceVisibility, deleteInvoice, recordPayment, getSummary,
    getInvoicePdf, previewInvoice, getInvoiceSettings, updateInvoiceSettings,
    refreshPdf,
};
