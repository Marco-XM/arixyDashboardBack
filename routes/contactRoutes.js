const express = require('express');
const {
    createContact,
    getContacts,
    getContactById,
    updateContact,
    deleteContact,
    getContactStats
} = require('../controllers/contactController');
const auth = require('../middleware/auth');

const router = express.Router();

// Public route for creating contact inquiries (from website)
router.post('/contacts', createContact);

// Protected routes for admin dashboard
router.get('/contacts', auth, getContacts);
router.get('/contacts/stats', auth, getContactStats);
router.get('/contacts/:id', auth, getContactById);
router.put('/contacts/:id', auth, updateContact);
router.delete('/contacts/:id', auth, deleteContact);

module.exports = router;
