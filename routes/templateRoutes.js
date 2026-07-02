const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
    getAllTemplates,
    getTemplateById,
    getDefaultTemplate,
    createTemplate,
    updateTemplate,
    setDefaultTemplate,
    deleteTemplate,
} = require('../controllers/templateController');

// Dashboard-only (admin/staff).
router.use(auth);

router.get('/', getAllTemplates);
router.get('/default', getDefaultTemplate);
router.get('/:id', getTemplateById);
router.post('/', createTemplate);
router.put('/:id', updateTemplate);
router.patch('/:id/set-default', setDefaultTemplate);
router.delete('/:id', deleteTemplate);

module.exports = router;
