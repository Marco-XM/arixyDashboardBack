const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
    getAllInvoices, getInvoiceById, createInvoice, createFromSubscription,
    updateInvoice, setInvoiceVisibility, deleteInvoice, recordPayment, getSummary,
    getInvoicePdf, previewInvoice, getInvoiceSettings, updateInvoiceSettings,
} = require('../controllers/financeController');
const {
    listExpenses, createExpense, updateExpense, deleteExpense,
    listTeam, listTeamAccounts, createMember, updateMember, deleteMember, getOverview,
} = require('../controllers/expenseController');

router.use(auth);

router.get('/summary', getSummary);
router.get('/overview', getOverview);

router.get('/invoice-settings', getInvoiceSettings);
router.put('/invoice-settings', updateInvoiceSettings);

router.get('/invoices', getAllInvoices);
router.post('/invoices/preview', previewInvoice);
router.get('/invoices/:id/pdf', getInvoicePdf);
router.get('/invoices/:id', getInvoiceById);
router.post('/invoices', createInvoice);
router.post('/invoices/from-subscription', createFromSubscription);
router.put('/invoices/:id', updateInvoice);
router.patch('/invoices/:id/visibility', setInvoiceVisibility);
router.delete('/invoices/:id', deleteInvoice);
router.post('/invoices/:id/payments', recordPayment);

// Costs: one-off purchases, recurring subscriptions and team salaries.
router.get('/expenses', listExpenses);
router.post('/expenses', createExpense);
router.put('/expenses/:id', updateExpense);
router.delete('/expenses/:id', deleteExpense);

router.get('/team', listTeam);
router.get('/team/accounts', listTeamAccounts);
router.post('/team', createMember);
router.put('/team/:id', updateMember);
router.delete('/team/:id', deleteMember);

module.exports = router;
