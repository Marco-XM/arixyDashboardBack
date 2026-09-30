const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const mongoose = require('mongoose');

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

        const invoice = new Invoice({
            number, company, subscription: subscription || undefined, document: document || undefined,
            type: type || 'project',
            lineItems: Array.isArray(lineItems) ? lineItems : [],
            tax: Number(tax || 0), currency: currency || 'USD',
            status: status || 'draft',
            issueDate: issueDate || Date.now(), dueDate: dueDate || undefined,
            period: period || undefined, notes: notes || '',
            visibleToClient: visibleToClient !== false,
            createdBy: req.user?._id,
        });
        await invoice.save();
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
        const sub = await Subscription.findById(subscriptionId).populate('service', 'name');
        if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });

        const serviceName = sub.serviceName || sub.service?.name || 'Service';
        const monthName = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(month)] || '';
        const invoice = new Invoice({
            company: sub.company,
            subscription: sub._id,
            type: 'maintenance',
            lineItems: [{ description: `${serviceName}${monthName ? ` — ${monthName} ${year}` : ''}`, quantity: 1, unitPrice: sub.price?.amount || 0 }],
            currency: sub.price?.currency || 'USD',
            status: 'draft',
            period: month ? { month: Number(month), year: Number(year) } : undefined,
            dueDate: dueDate || undefined,
            visibleToClient: visibleToClient !== false,
            createdBy: req.user?._id,
        });
        await invoice.save();
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
        await invoice.save();
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

        res.json({ success: true, message: 'Payment recorded', data: { invoice, amountPaid } });
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({ success: false, message: 'Error recording payment', error: error.message });
    }
};

/* ------------------------------- Summary --------------------------------- */

const getSummary = async (req, res) => {
    try {
        const { company } = req.query;
        const match = company ? { company: new mongoose.Types.ObjectId(String(company)) } : {};

        const [byStatus, totals, paidAgg] = await Promise.all([
            Invoice.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$total' } } }]),
            Invoice.aggregate([{ $match: match }, { $group: { _id: null, invoiced: { $sum: '$total' }, count: { $sum: 1 } } }]),
            Payment.aggregate([{ $match: company ? { company: new mongoose.Types.ObjectId(String(company)) } : {} }, { $group: { _id: null, collected: { $sum: '$amount' } } }]),
        ]);

        const invoiced = totals[0]?.invoiced || 0;
        const collected = paidAgg[0]?.collected || 0;
        res.json({
            success: true,
            data: {
                invoiced,
                collected,
                outstanding: Math.max(0, invoiced - collected),
                invoiceCount: totals[0]?.count || 0,
                byStatus: byStatus.reduce((o, s) => { o[s._id] = { count: s.count, total: s.total }; return o; }, {}),
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
};
