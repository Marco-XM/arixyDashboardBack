const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String },
    mobileNumber1: { type: String, required: true },
    mobileNumber2: { type: String },
    state: { type: String, required: true },
    eventType: { type: String, required: true },
    otherEventType: { type: String },
    location: { type: String, required: true },
    subject: { type: String },
    message: { type: String },
    selectedDate: { type: String, required: true },
    startTime: { type: String, required: true },
    totalPrice: { type: Number, required: true },
    maxHours: { type: Number, required: true },
    selectedPackages: { type: String, required: true },
    confirmed: { type: Boolean, default: false },
    declined: { type: Boolean, default: false }
});

module.exports = mongoose.model('Booking', bookingSchema);