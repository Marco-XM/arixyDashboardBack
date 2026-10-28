// One-off: give every invoice without a number one (INV-<year>-NNNN, in the
// order they were created) and render the stored PDF the portal serves.
//
//   node scripts/backfillInvoices.js            # dry run
//   node scripts/backfillInvoices.js --apply

require('dotenv').config();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const InvoiceCounter = require('../models/InvoiceCounter');
require('../models/Company');
require('../models/Payment');
const { refreshPdf } = require('../controllers/financeController');

const apply = process.argv.includes('--apply');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const invoices = await Invoice.find().sort({ createdAt: 1 }).select('number createdAt').lean();
    console.log(`${invoices.length} invoices${apply ? '' : ' (dry run)'}`);

    for (const inv of invoices) {
        let { number } = inv;
        if (!number) {
            const year = new Date(inv.createdAt || Date.now()).getUTCFullYear();
            number = apply ? await InvoiceCounter.next(year) : `INV-${year}-????`;
            if (apply) await Invoice.updateOne({ _id: inv._id }, { $set: { number } });
        }
        if (apply) await refreshPdf(inv._id);
        console.log(`  ${inv._id}  ${number}${inv.number ? '' : '  (new number)'}`);
    }

    await mongoose.disconnect();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
