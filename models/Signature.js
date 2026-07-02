const mongoose = require('mongoose');

// A reusable signature image that can be dropped into PDF templates
// (the editor's signature blocks pick from these).
const signatureSchema = new mongoose.Schema({
    signatureName: { type: String, required: true, trim: true },
    imageURL: { type: String, required: true },
    cloudinaryId: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: false },
}, { timestamps: true });

module.exports = mongoose.model('Signature', signatureSchema);
