const express = require('express');
const router = express.Router();
const blockedDateController = require('../controllers/blockedDateController');
const auth = require('../middleware/auth');

router.get('/blocked-dates', blockedDateController.getBlockedDates);
router.post('/blocked-dates', auth, blockedDateController.addBlockedDate);
router.delete('/blocked-dates/:id', auth, blockedDateController.removeBlockedDateById);
router.get('/blocked-dates/count', auth, blockedDateController.getBlockedDatesCount);

module.exports = router;