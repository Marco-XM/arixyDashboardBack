const mongoose = require('mongoose');


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
    fx: { type: lockedFxSchema, default: undefined },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: false },
}, { timestamps: true });

paymentSchema.index({ invoice: 1 });
paymentSchema.index({ company: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
