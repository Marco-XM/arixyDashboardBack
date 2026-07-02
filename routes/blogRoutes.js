const express = require('express');
const multer = require('multer');
const { blogStorage } = require('../controllers/cloudinary');
const auth = require('../middleware/auth');
const {
  getBlogs,
  getBlogsCount,
  getBlogBySlug,
  getBlogById,
  createBlog,
  updateBlog,
  deleteBlog,
} = require('../controllers/blogController');

const router = express.Router();
const upload = multer({
  storage: blogStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed!'), false);
  },
});

// Public reads
router.get('/blogs', getBlogs);
router.get('/blogs/count', getBlogsCount);
router.get('/blogs/slug/:slug', getBlogBySlug);
router.get('/blogs/:id', getBlogById);

// Protected mutations
router.post('/blogs', auth, upload.single('coverImage'), createBlog);
router.put('/blogs/:id', auth, upload.single('coverImage'), updateBlog);
router.delete('/blogs/:id', auth, deleteBlog);

module.exports = router;
