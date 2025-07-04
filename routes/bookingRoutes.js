const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const auth = require('../middleware/auth');

router.post('/bookings', bookingController.createBooking);
router.get('/bookings', auth, bookingController.getBookings);
router.get('/bookings/count', auth, bookingController.getBookingCount);
router.patch('/bookings/confirm/:id', auth, bookingController.confirmBooking);
router.delete('/bookings/decline/:id', auth, bookingController.declineBooking);
router.get('/bookings/confirmed', auth, bookingController.getConfirmedBookings);
router.get('/bookings/unconfirmed/count', auth, bookingController.getUnconfirmedBookingCount);
router.get('/bookings/confirmed/count', auth, bookingController.getConfirmedBookingCount);

module.exports = router;