const mongoose = require('mongoose');

// A payment recorded against an invoice. Invoice status is derived from the sum
// of its payments vs its total.
const paymentSchema = new mongoose.Schema({
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    method: { type: String, enum: ['bank', 'card', 'cash', 'other'], default: 'bank' },
    reference: { type: String, trim: true, default: '' },
    paidAt: { type: Date, default: Date.now },
    notes: { type: String, trim: true, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: false },
}, { timestamps: true });

paymentSchema.index({ invoice: 1 });
paymentSchema.index({ company: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
