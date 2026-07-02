const mongoose = require('mongoose');

// A company's subscription to a service. Drives "services you're subscribed to"
// in the portal and recurring maintenance billing in finance.
const subscriptionSchema = new mongoose.Schema({
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    // Denormalized name for display convenience / historical accuracy.
    serviceName: { type: String, trim: true, default: '' },
    price: {
        amount: { type: Number, default: 0 },
        currency: { type: String, default: 'USD' }
    },
    billingCycle: {
        type: String,
        enum: ['monthly', 'annual', 'one-time'],
        default: 'monthly'
    },
    startDate: { type: Date },
    endDate: { type: Date },
    status: {
        type: String,
        enum: ['active', 'paused', 'cancelled'],
        default: 'active'
    },
    notes: { type: String, trim: true, default: '' },
}, { timestamps: true });

subscriptionSchema.index({ company: 1, status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
