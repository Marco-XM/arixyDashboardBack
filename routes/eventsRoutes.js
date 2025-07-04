const express = require('express');
const { uploadImage, getEvents, deleteEvent, getEventCount } = require('../controllers/eventsController');
const auth = require('../middleware/auth');
const router = express.Router();

router.post('/events/upload', auth, uploadImage);
router.get('/events', getEvents);
router.delete('/events/:id', auth, deleteEvent);
router.get('/events/count', auth, getEventCount); // Add this line

module.exports = router;