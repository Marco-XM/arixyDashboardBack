const express = require('express');
const router = express.Router();
const multer = require('multer');
const { signatureStorage } = require('../controllers/cloudinary');
const auth = require('../middleware/auth');
const handleUploadError = require('../middleware/uploadError');
const { getAllSignatures, createSignature, deleteSignature } = require('../controllers/signatureController');

const upload = multer({
    storage: signatureStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are allowed!'), false);
    },
});

router.use(auth);
router.get('/', getAllSignatures);
router.post('/', upload.single('image'), handleUploadError, createSignature);
router.delete('/:id', deleteSignature);

module.exports = router;
