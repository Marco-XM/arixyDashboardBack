const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
    getAllDocuments,
    getDocumentById,
    createDocument,
    updateDocument,
    deleteDocument,
    generatePdf,
    previewPdf,
    previewPages,
    viewDocument,
} = require('../controllers/documentController');

// Dashboard-only (admin/staff).
router.use(auth);

router.post('/preview', previewPdf); // ad-hoc section render
router.post('/preview-pages', previewPages); // page/block render for the rich editor
router.get('/:id/view', viewDocument); // stream a document's PDF inline
router.get('/', getAllDocuments);
router.get('/:id', getDocumentById);
router.post('/', createDocument);
router.put('/:id', updateDocument);
router.delete('/:id', deleteDocument);
router.post('/:id/generate', generatePdf);

module.exports = router;
