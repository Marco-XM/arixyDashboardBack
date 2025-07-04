const Booking = require('../models/Booking');

// 1. Create Booking (Real-Time)
const createBooking = async (req, res) => {
    try {
        const booking = new Booking(req.body);
        await booking.save();

        res.status(201).send(booking);
    } catch (error) {
        console.error('Error creating booking:', error);
        res.status(400).send(error);
    }
};

// 2. Get All Bookings
const getBookings = async (req, res) => {
    try {
        const bookings = await Booking.find();
        res.send(bookings);
    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).send(error);
    }
};

// 3. Get Booking Count
const getBookingCount = async (req, res) => {
    try {
        const count = await Booking.countDocuments();
        res.send({ count });
    } catch (error) {
        console.error('Error getting booking count:', error);
        res.status(500).send(error);
    }
};

// 4. Confirm Booking (Real-Time)
const confirmBooking = async (req, res) => {
    try {
        const booking = await Booking.findByIdAndUpdate(
            req.params.id,
            { confirmed: true },
            { new: true }
        );

        if (!booking) {
            return res.status(404).send({ error: 'Booking not found' });
        }
        res.send(booking);
    } catch (error) {
        console.error('Error confirming booking:', error);
        res.status(400).send(error);
    }
};

// 5. Decline (Delete) Booking (Real-Time)
const declineBooking = async (req, res) => {
    try {
        const booking = await Booking.findByIdAndDelete(req.params.id);

        if (!booking) {
            return res.status(404).send({ error: 'Booking not found' });
        }

        res.send({ message: 'Booking declined and deleted', booking });
    } catch (error) {
        console.error('Error declining booking:', error);
        res.status(400).send(error);
    }
};

// 6. Get Confirmed Bookings
const getConfirmedBookings = async (req, res) => {
    try {
        const confirmedBookings = await Booking.find({ confirmed: true });
        res.send(confirmedBookings);
    } catch (error) {
        console.error('Error fetching confirmed bookings:', error);
        res.status(500).send(error);
    }
};

const getUnconfirmedBookingCount = async (req, res) => {
    try {
        const count = await Booking.countDocuments({ confirmed: false });
        res.send({ count });
    } catch (error) {
        res.status(500).send(error);
    }
};

const getConfirmedBookingCount = async (req, res) => {
    try {
        const count = await Booking.countDocuments({ confirmed: true });
        res.send({ count });
    } catch (error) {
        res.status(500).send(error);
    }
};


// Export Controllers
module.exports = {
    createBooking,
    getBookings,
    getBookingCount,
    confirmBooking,
    declineBooking,
    getConfirmedBookings,
    getUnconfirmedBookingCount,
    getConfirmedBookingCount
};
