const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
    name: { type: String, trim: true, default: '' },        // product or service
    description: { type: String, trim: true, default: '' }, // what it covers
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 }, // 0 → shown as "Free"
    amount: { type: Number, default: 0 }, // quantity * unitPrice (computed on save)
}, { _id: false });

// Value locked in the home currency when the record was saved (utils/fx.js
// lockFx), so later rate moves never change it.
const lockedFxSchema = new mongoose.Schema({
    home: { type: String },          // home currency, e.g. EGP
    rate: { type: Number },          // home units per 1 unit of the record's currency
    amountHome: { type: Number },    // the amount in the home currency
    date: { type: Date },            // rate date (transaction date)
    source: { type: String },
    manual: { type: Boolean, default: false }, // entered as the actual amount charged/received
}, { _id: false });

// A bill sent to a company — either recurring maintenance (tied to a subscription
// + period) or a one-off project fee.
const invoiceSchema = new mongoose.Schema({
    number: { type: String, trim: true }, // human-friendly invoice number
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', required: false },
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: false },
    type: { type: String, enum: ['maintenance', 'project'], default: 'project' },

    lineItems: [lineItemSchema],
    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },      // absolute tax amount
    total: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    // Total locked in the home currency at the issue date's rate.
    fx: { type: lockedFxSchema, default: undefined },

    status: { type: String, enum: ['draft', 'sent', 'paid', 'partial', 'overdue', 'void'], default: 'draft' },
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date },
    paidDate: { type: Date },

    // For recurring maintenance invoices.
    period: {
        month: { type: Number, min: 1, max: 12 },
        year: { type: Number }
    },

    notes: { type: String, trim: true, default: '' },
    // Whether the company can see this invoice in the client portal.
    visibleToClient: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: false },

    // Branded PDF, re-rendered by the dashboard whenever the invoice or its
    // payments change; the portal backend only streams these bytes.
    pdf: {
        data: { type: Buffer, select: false },
        size: { type: Number },
        generatedAt: { type: Date },
    },
}, { timestamps: true });

invoiceSchema.index({ company: 1, status: 1, createdAt: -1 });

// Keep line-item amounts and totals consistent.
invoiceSchema.pre('save', function (next) {
    this.lineItems = (this.lineItems || []).map((li) => {
        const item = typeof li.toObject === 'function' ? li.toObject() : li;
        return { ...item, amount: Number(item.quantity || 0) * Number(item.unitPrice || 0) };
    });
    this.subtotal = this.lineItems.reduce((s, li) => s + Number(li.amount || 0), 0);
    this.total = this.subtotal + Number(this.tax || 0);
    // A free invoice has nothing to collect, so it is settled once issued.
    if (this.total === 0 && ['sent', 'partial', 'overdue'].includes(this.status)) {
        this.status = 'paid';
        if (!this.paidDate) this.paidDate = new Date();
    }
    next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);
