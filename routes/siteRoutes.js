const express = require('express');
const multer = require('multer');
const auth = require('../middleware/auth');
const { contentStorage, heroStorage } = require('../controllers/cloudinary');
const SiteSettings = require('../models/SiteSettings');

const router = express.Router();

// Images embedded into blog/project HTML bodies. Uploaded immediately from the
// editor (before the post/project is submitted) so the author gets a public
// URL to drop into the HTML.
const contentUpload = multer({
  storage: contentStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed!'), false);
  },
});

// Hero background: a single image or video.
const heroUpload = multer({
  storage: heroStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB (videos)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only image or video files are allowed!'), false);
  },
});

// @route   POST /api/uploads/image
// @desc    Upload a content image, get back its public URL (for HTML bodies)
router.post('/uploads/image', auth, (req, res) => {
  contentUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message });
    if (!req.file) return res.status(400).json({ message: 'No image file provided' });
    // multer-storage-cloudinary puts the secure URL on req.file.path.
    res.json({ url: req.file.path, publicId: req.file.filename });
  });
});

// @route   GET /api/settings/site
// @desc    Public website settings (hero background) — read by the landing site
router.get('/settings/site', async (req, res) => {
  try {
    const settings = await SiteSettings.getSingleton();
    res.json(settings);
  } catch (err) {
    console.error('Error fetching site settings:', err);
    res.status(500).json({ message: 'Error fetching site settings' });
  }
});

// @route   PUT /api/settings/hero
// @desc    Replace the hero background. Accepts either a multipart upload
//          (field "media": image or video) or a JSON body { url, type } to
//          point at an already-hosted asset.
router.put('/settings/hero', auth, (req, res) => {
  heroUpload.single('media')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    try {
      const settings = await SiteSettings.getSingleton();
      if (req.file) {
        settings.heroMedia = {
          url: req.file.path,
          type: req.file.mimetype.startsWith('video/') ? 'video' : 'image',
          publicId: req.file.filename,
        };
      } else if (req.body && req.body.url !== undefined) {
        const type = req.body.type === 'video' ? 'video' : (req.body.url ? 'image' : '');
        settings.heroMedia = { url: String(req.body.url), type, publicId: '' };
      } else {
        return res.status(400).json({ message: 'Provide a "media" file or a { url, type } body' });
      }
      await settings.save();
      res.json(settings);
    } catch (e) {
      console.error('Error updating hero media:', e);
      res.status(500).json({ message: 'Error updating hero media', error: e.message });
    }
  });
});

// @route   DELETE /api/settings/hero
// @desc    Reset the hero background to the built-in default
router.delete('/settings/hero', auth, async (req, res) => {
  try {
    const settings = await SiteSettings.getSingleton();
    settings.heroMedia = { url: '', type: '', publicId: '' };
    await settings.save();
    res.json(settings);
  } catch (err) {
    console.error('Error resetting hero media:', err);
    res.status(500).json({ message: 'Error resetting hero media' });
  }
});

module.exports = router;
