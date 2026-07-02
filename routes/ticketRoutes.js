const express = require('express');
const router = express.Router();
const multer = require('multer');
const { ticketStorage } = require('../controllers/cloudinary');
const auth = require('../middleware/auth');
const handleUploadError = require('../middleware/uploadError');
const { getAllTickets, getTicketById, updateTicket, replyTicket, deleteTicket } = require('../controllers/ticketController');

const upload = multer({ storage: ticketStorage, limits: { fileSize: 25 * 1024 * 1024 } });

// Dashboard-only (admin/staff).
router.use(auth);

router.get('/', getAllTickets);
router.get('/:id', getTicketById);
router.put('/:id', updateTicket);
router.post('/:id/reply', upload.array('attachments', 5), handleUploadError, replyTicket);
router.delete('/:id', deleteTicket);

module.exports = router;
