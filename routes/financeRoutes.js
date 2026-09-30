const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
    getAllInvoices, getInvoiceById, createInvoice, createFromSubscription,
    updateInvoice, setInvoiceVisibility, deleteInvoice, recordPayment, getSummary,
} = require('../controllers/financeController');

router.use(auth);

router.get('/summary', getSummary);
router.get('/invoices', getAllInvoices);
router.get('/invoices/:id', getInvoiceById);
router.post('/invoices', createInvoice);
router.post('/invoices/from-subscription', createFromSubscription);
router.put('/invoices/:id', updateInvoice);
router.patch('/invoices/:id/visibility', setInvoiceVisibility);
router.delete('/invoices/:id', deleteInvoice);
router.post('/invoices/:id/payments', recordPayment);

module.exports = router;
