const express = require('express');
const router = express.Router();
const multer = require('multer');
const { companyStorage } = require('../controllers/cloudinary');
const auth = require('../middleware/auth');
const {
    getAllCompanies,
    getCompanyById,
    createCompany,
    updateCompany,
    deleteCompany,
    getCompanyStats,
    getCompanyUsers,
    createCompanyUser,
    updateCompanyUser,
    deleteCompanyUser
} = require('../controllers/companyController');

const upload = multer({
    storage: companyStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are allowed!'), false);
    }
});

const handleMulterError = (err, req, res, next) => {
    if (err) {
        return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    }
    next();
};

// All company-management endpoints are dashboard-only (admin/staff).
router.use(auth);

// Company CRUD
router.get('/', getAllCompanies);
router.get('/stats', getCompanyStats);
router.get('/:id', getCompanyById);
router.post('/', upload.single('logo'), handleMulterError, createCompany);
router.put('/:id', upload.single('logo'), handleMulterError, updateCompany);
router.delete('/:id', deleteCompany);

// Company staff-user management (nested under a company)
router.get('/:id/users', getCompanyUsers);
router.post('/:id/users', createCompanyUser);
router.put('/:id/users/:userId', updateCompanyUser);
router.delete('/:id/users/:userId', deleteCompanyUser);

module.exports = router;
