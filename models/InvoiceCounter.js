const mongoose = require('mongoose');

// One sequence per year for human-friendly invoice numbers (INV-2026-0001).
const invoiceCounterSchema = new mongoose.Schema({
    year: { type: Number, required: true, unique: true },
    seq: { type: Number, default: 0 },
});

invoiceCounterSchema.statics.next = async function (year) {
    const row = await this.findOneAndUpdate(
        { year },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return `INV-${year}-${String(row.seq).padStart(4, '0')}`;
};

module.exports = mongoose.model('InvoiceCounter', invoiceCounterSchema);
