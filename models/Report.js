const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String },
    mobileNumber1: { type: String, required: true },
    mobileNumber2: { type: String },
    subject: { type: String },
    message: { type: String }
});

module.exports = mongoose.model('Report', reportSchema);