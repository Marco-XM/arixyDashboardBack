const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    amount: { type: Number, default: 0 }, // quantity * unitPrice (computed on save)
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
}, { timestamps: true });

invoiceSchema.index({ company: 1, status: 1, createdAt: -1 });

// Keep line-item amounts and totals consistent.
invoiceSchema.pre('save', function (next) {
    this.lineItems = (this.lineItems || []).map((li) => ({
        ...li,
        amount: Number(li.quantity || 0) * Number(li.unitPrice || 0),
    }));
    this.subtotal = this.lineItems.reduce((s, li) => s + Number(li.amount || 0), 0);
    this.total = this.subtotal + Number(this.tax || 0);
    next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);
