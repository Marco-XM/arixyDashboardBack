const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
    url: { type: String, required: true },
    publicId: { type: String },
    type: { type: String }, // mimetype
    name: { type: String },
}, { _id: false });

const messageSchema = new mongoose.Schema({
    authorType: { type: String, enum: ['company', 'staff'], required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId },
    authorName: { type: String },
    text: { type: String, trim: true, default: '' },
    attachments: [attachmentSchema],
    createdAt: { type: Date, default: Date.now },
}, { _id: true });

// A support ticket raised by a company user, triaged by Arixy staff.
const ticketSchema = new mongoose.Schema({
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyUser' },
    createdByName: { type: String },
    subject: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: 'general' },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: ['open', 'in-progress', 'resolved', 'closed'], default: 'open' },
    attachments: [attachmentSchema], // screenshots on the initial report
    relatedSubscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    messages: [messageSchema],
}, { timestamps: true });

ticketSchema.index({ company: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Ticket', ticketSchema);
