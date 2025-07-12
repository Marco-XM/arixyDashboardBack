const express = require('express');
const router = express.Router();
const multer = require('multer');
const { clientStorage } = require('../controllers/cloudinary');
const auth = require('../middleware/auth');
const {
    getAllClients,
    getClientById,
    createClient,
    updateClient,
    deleteClient,
    getClientStats,
    getActiveClients
} = require('../controllers/clientController');

// Configure multer for file uploads using clientStorage for client logos
const upload = multer({ 
  storage: clientStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    console.log('Client file filter check:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype
    });
    
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Error handling middleware for multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Client Multer Error:', err);
    return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
  } else if (err) {
    console.error('Client Upload Error:', err);
    return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
  }
  next();
};

// Simple test route to check if basic routing works
router.get('/test', (req, res) => {
    res.json({ message: 'Client routes are working', timestamp: new Date() });
});

// Test POST route without file upload
router.post('/test-post', (req, res) => {
    console.log('Test POST route hit');
    console.log('Request body:', req.body);
    res.json({ message: 'Test POST working', body: req.body });
});

// Public routes
router.get('/active', getActiveClients);

// Protected routes (require authentication)
router.use(auth);

// Client CRUD operations
router.get('/', getAllClients);
router.get('/stats', getClientStats);
router.get('/:id', getClientById);
router.post('/', upload.single('logo'), handleMulterError, createClient);
router.put('/:id', upload.single('logo'), handleMulterError, updateClient);
router.delete('/:id', deleteClient);

module.exports = router;
