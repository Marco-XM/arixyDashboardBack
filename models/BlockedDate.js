const mongoose = require('mongoose');

const blockedDateSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true
    },
    startTime: {
        type: String,
        required: false
    },
    endTime: {
        type: String,
        required: false
    }
});

const BlockedDate = mongoose.model('BlockedDate', blockedDateSchema);

module.exports = BlockedDate;