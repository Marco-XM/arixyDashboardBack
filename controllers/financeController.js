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

// Next automatic number, skipping any that already exist (e.g. typed by hand).
async function nextInvoiceNumber() {
    const year = new Date().getUTCFullYear();
    for (let i = 0; i < 50; i += 1) {
        const number = await InvoiceCounter.next(year); // eslint-disable-line no-await-in-loop
        if (!(await Invoice.exists({ number }))) return number; // eslint-disable-line no-await-in-loop
    }
    throw new Error('Could not find a free invoice number');
}

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

// Re-render the stored copy the client downloads from the portal and re-lock
// the total's home-currency value at the issue date's rate. A failure must
// not undo the change that triggered it, so it is only logged.
async function refreshPdf(invoiceId) {
    try {
        const invoice = await Invoice.findById(invoiceId).lean();
        if (!invoice) return;
        // Keep an existing lock unless the total, currency or issue date changed.
        const issued = new Date(invoice.issueDate || invoice.createdAt);
        if (!fx.lockMatches(invoice.fx, invoice.total, invoice.currency, issued)) {
            const locked = await fx.lockFx(invoice.total, invoice.currency, issued);
            if (locked) await Invoice.updateOne({ _id: invoiceId }, { $set: { fx: locked } });
        }
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
// Numbering state for this year: the next automatic number and the highest
// INV-<year>-NNNN already used (the next number must stay above it).
async function numberingState() {
    const year = new Date().getUTCFullYear();
    const [counter, used] = await Promise.all([
        InvoiceCounter.findOne({ year }).lean(),
        Invoice.find({ number: new RegExp(`^INV-${year}-\\d+$`) }).select('number').lean(),
    ]);
    const highestUsed = used.reduce((m, i) => Math.max(m, Number(i.number.split('-')[2]) || 0), 0);
    return { year, nextNumber: Math.max(counter?.seq || 0, highestUsed) + 1, highestUsed };
}

const settingsPayload = async (s) => ({
    invoicePaymentDetails: s.invoicePaymentDetails || '',
    invoiceNote: s.invoiceNote || '',
    ...(await numberingState()),
});

const getInvoiceSettings = async (req, res) => {
    try {
        res.json({ success: true, data: await settingsPayload(await getBranding()) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error loading invoice settings', error: error.message });
    }
};

const updateInvoiceSettings = async (req, res) => {
    try {
        // Next invoice number for this year (the counter stores the last one used).
        if (req.body.nextNumber !== undefined && req.body.nextNumber !== '') {
            const next = Number(req.body.nextNumber);
            if (!Number.isInteger(next) || next < 1 || next > 999999) {
                return res.status(400).json({ success: false, message: 'The next invoice number must be a whole number from 1 to 999999' });
            }
            const { year, highestUsed } = await numberingState();
            if (next <= highestUsed) {
                return res.status(400).json({
                    success: false,
                    message: `INV-${year}-${String(highestUsed).padStart(4, '0')} is already used, so the next number must be ${highestUsed + 1} or higher`,
                });
            }
            await InvoiceCounter.updateOne({ year }, { $set: { seq: next - 1 } }, { upsert: true });
        }

        const settings = await ReportSettings.getSingleton();
        const before = `${settings.invoicePaymentDetails}\n${settings.invoiceNote}`;
        if (req.body.invoicePaymentDetails !== undefined) settings.invoicePaymentDetails = str(req.body.invoicePaymentDetails, 2000);
        if (req.body.invoiceNote !== undefined) settings.invoiceNote = str(req.body.invoiceNote, 300);
        await settings.save();
        // Invoice PDFs print the payment details and note, so refresh the
        // unpaid ones when those changed.
        if (`${settings.invoicePaymentDetails}\n${settings.invoiceNote}` !== before) {
            const unpaid = await Invoice.find({ status: { $in: ['draft', 'sent', 'partial', 'overdue'] } }).select('_id').lean();
            for (const inv of unpaid) await refreshPdf(inv._id); // eslint-disable-line no-await-in-loop
        }
        res.json({ success: true, message: 'Invoice settings saved', data: await settingsPayload(settings) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error saving invoice settings', error: error.message });
    }
};

/* ------------------------------- Payments -------------------------------- */

const recordPayment = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

        const { amount, method, reference, paidAt, notes, amountHome } = req.body;
        if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: 'A positive amount is required' });

        // Lock the home-currency value at the payment date's rate, or the
        // amount actually received when it was entered.
        const when = paidAt ? new Date(paidAt) : new Date();
        await Payment.create({
            invoice: invoice._id, company: invoice.company, amount: Number(amount),
            currency: invoice.currency, method: method || 'bank', reference: reference || '',
            paidAt: when, notes: notes || '', recordedBy: req.user?._id,
            fx: await fx.lockFx(Number(amount), invoice.currency, when, amountHome),
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

// GET /api/finance/summary?currency=EGP[&company=] — totals in one currency.
// Invoices and payments count at the home-currency value locked when they
// were saved; only a display currency other than the home one (or an old
// record without a lock) is converted, at today's rates.
const getSummary = async (req, res) => {
    try {
        const { company } = req.query;
        const currency = str(req.query.currency, 8).toUpperCase() || 'EGP';
        const match = company ? { company: new mongoose.Types.ObjectId(String(company)) } : {};

        const [invoices, payments] = await Promise.all([
            Invoice.find(match).select('status total currency fx').lean(),
            Payment.find(match).select('amount currency fx').lean(),
        ]);

        // Value of a record in the display currency.
        const valueOf = (doc, amount) => {
            const cur = String(doc.currency || currency).toUpperCase();
            if (cur === currency) return { amount, cur: currency };
            if (doc.fx?.home && Number.isFinite(doc.fx.amountHome)) return { amount: doc.fx.amountHome, cur: doc.fx.home };
            return { amount, cur };
        };
        const parts = [...invoices.map((i) => valueOf(i, i.total)), ...payments.map((p) => valueOf(p, p.amount))];
        const latest = parts.some((p) => p.cur !== currency) ? await fx.getLatest().catch(() => null) : null;
        const unconverted = new Set();
        const conv = ({ amount, cur }) => {
            const v = cur === currency ? amount : fx.convert(amount, cur, currency, latest?.rates);
            if (v === null) { unconverted.add(cur); return 0; }
            return v;
        };

        const statuses = {};
        let invoiced = 0;
        invoices.forEach((inv) => {
            const v = conv(valueOf(inv, inv.total));
            invoiced += v;
            const s = statuses[inv.status] || (statuses[inv.status] = { count: 0, total: 0 });
            s.count += 1;
            s.total += v;
        });
        const invoiceCount = invoices.length;
        const collected = payments.reduce((t, p) => t + conv(valueOf(p, p.amount)), 0);

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
