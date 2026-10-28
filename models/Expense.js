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

// Money Arixy spends: a one-off purchase (hardware, a licence, an ad budget)
// or a recurring subscription (hosting, SaaS seats, domains). Recurring
// expenses are charged every cycle from `date` until `endDate` (when the
// subscription was cancelled); the finance overview expands them per month.
const expenseSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    vendor: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: 'Other' },
    kind: { type: String, enum: ['one-time', 'recurring'], default: 'one-time' },
    billingCycle: { type: String, enum: ['monthly', 'quarterly', 'yearly'], default: 'monthly' },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, trim: true, uppercase: true, default: 'EGP' },
    // Purchase date, or the first charge of a subscription.
    date: { type: Date, required: true, default: Date.now },
    // Recurring only: last day it was paid for (empty → still active).
    endDate: { type: Date },
    // Optional: the client this cost was incurred for.
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: false },
    paymentMethod: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    // One-time purchases only (recurring charges use each charge date's rate).
    fx: { type: lockedFxSchema, default: undefined },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: false },
}, { timestamps: true });

expenseSchema.index({ kind: 1, date: -1 });
expenseSchema.index({ category: 1 });

module.exports = mongoose.model('Expense', expenseSchema);
