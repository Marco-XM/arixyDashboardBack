const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const auth = require('../middleware/auth');

router.post('/reports', reportController.createReport);
router.get('/reports', auth, reportController.getReports);
router.get('/reports/count', auth, reportController.getReportCount);
router.delete('/reports/:id', auth, reportController.deleteReportById);

module.exports = router;