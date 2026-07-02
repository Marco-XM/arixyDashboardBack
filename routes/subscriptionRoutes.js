const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getAllSubscriptions, createSubscription, updateSubscription, deleteSubscription } = require('../controllers/subscriptionController');

router.use(auth);
router.get('/', getAllSubscriptions);
router.post('/', createSubscription);
router.put('/:id', updateSubscription);
router.delete('/:id', deleteSubscription);

module.exports = router;
