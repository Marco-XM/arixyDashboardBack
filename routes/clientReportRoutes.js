const express = require('express');
const multer = require('multer');
const auth = require('../middleware/auth');
const c = require('../controllers/clientReportController');

const router = express.Router();

// Uploaded PDFs are stored on the report document itself. Vercel rejects
// request bodies over 4.5 MB, so cap uploads just below that.
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const pdfUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_BYTES },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '')) cb(null, true);
        else cb(new Error('Only PDF files are allowed'), false);
    },
});

const withPdf = (req, res, next) => {
    pdfUpload.single('file')(req, res, (err) => {
        if (!err) return next();
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'The PDF is larger than 4 MB' : `Upload error: ${err.message}`;
        res.status(400).json({ success: false, message });
    });
};

// Dashboard-only (admin/staff). Clients read published reports through the
// portal backend (arixyBackend /api/portal/client-reports).
router.use(auth);

router.post('/preview', c.previewReport);
router.post('/upload', withPdf, c.uploadReport);

router.get('/', c.listReports);
router.post('/', c.createReport);
router.get('/:id', c.getReport);
router.put('/:id', c.updateReport);
router.delete('/:id', c.deleteReport);
router.put('/:id/file', withPdf, c.replaceReportFile);
router.post('/:id/publish', c.publishReport);
router.post('/:id/unpublish', c.unpublishReport);
router.get('/:id/pdf', c.downloadReportPdf);

module.exports = router;
