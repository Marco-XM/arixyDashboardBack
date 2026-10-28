const mongoose = require('mongoose');

// Cached exchange rates, all relative to 1 USD. `key` is 'latest' (refreshed
// automatically once it is a few hours old) or 'YYYY-MM' for a past month's
// rate, which never changes once stored.
const fxRateSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    base: { type: String, default: 'USD' },
    rates: { type: mongoose.Schema.Types.Mixed, default: {} },
    source: { type: String, default: '' },
    asOf: { type: Date },        // when the provider published the rates
    fetchedAt: { type: Date },   // when we downloaded them
}, { timestamps: true });

module.exports = mongoose.model('FxRate', fxRateSchema);
