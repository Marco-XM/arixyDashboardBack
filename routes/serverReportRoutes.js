const express = require('express');
const multer = require('multer');
const auth = require('../middleware/auth');
const { brandingStorage } = require('../controllers/cloudinary');
const c = require('../controllers/serverReportController');

const router = express.Router();

const logoUpload = multer({
    storage: brandingStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are allowed'), false);
    },
});

// Dashboard-only (admin/staff). Clients read published reports through the
// portal backend (arixyBackend /api/portal/reports).
router.use(auth);

router.get('/branding', c.getBrandingSettings);
router.put('/branding', (req, res, next) => {
    logoUpload.single('logo')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
        next();
    });
}, c.updateBrandingSettings);

router.get('/previous', c.getPreviousReport);
router.post('/preview', c.previewReport);

router.get('/', c.listReports);
router.post('/', c.createReport);
router.get('/:id', c.getReport);
router.put('/:id', c.updateReport);
router.delete('/:id', c.deleteReport);
router.post('/:id/publish', c.publishReport);
router.post('/:id/unpublish', c.unpublishReport);
router.get('/:id/pdf', c.downloadReportPdf);
router.get('/:id/email-defaults', c.getEmailDefaults);
router.post('/:id/email', c.emailReport);

module.exports = router;
