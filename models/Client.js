const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    logo: {
        type: String,
        required: true
    },
    cloudinaryId: {
        type: String,
        required: false
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    displayOrder: {
        type: Number,
        default: 0
    },
    website: {
        type: String,
        required: false,
        trim: true
    },
    description: {
        type: String,
        required: false,
        trim: true
    }
}, {
    timestamps: true
});

// Index for better query performance
clientSchema.index({ status: 1, displayOrder: 1 });
clientSchema.index({ name: 1 });

module.exports = mongoose.model('Client', clientSchema);
