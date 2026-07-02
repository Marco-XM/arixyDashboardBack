const Signature = require('../models/Signature');
const { cloudinary } = require('./cloudinary');

const getAllSignatures = async (req, res) => {
    try {
        const signatures = await Signature.find().sort({ createdAt: -1 });
        res.json({ success: true, data: signatures });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching signatures', error: error.message });
    }
};

const createSignature = async (req, res) => {
    try {
        const { signatureName } = req.body;
        if (!signatureName) return res.status(400).json({ success: false, message: 'Signature name is required' });
        if (!req.file) return res.status(400).json({ success: false, message: 'Signature image is required' });
        const signature = new Signature({
            signatureName: signatureName.trim(),
            imageURL: req.file.path,
            cloudinaryId: req.file.filename,
            createdBy: req.user?._id,
        });
        await signature.save();
        res.status(201).json({ success: true, message: 'Signature created', data: signature });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error creating signature', error: error.message });
    }
};

const deleteSignature = async (req, res) => {
    try {
        const signature = await Signature.findById(req.params.id);
        if (!signature) return res.status(404).json({ success: false, message: 'Signature not found' });
        if (signature.cloudinaryId) {
            try { await cloudinary.uploader.destroy(signature.cloudinaryId); } catch (e) { /* ignore */ }
        }
        await Signature.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Signature deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting signature', error: error.message });
    }
};

module.exports = { getAllSignatures, createSignature, deleteSignature };
