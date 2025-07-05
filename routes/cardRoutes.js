const express = require('express');
const multer = require('multer');
const { storage } = require('../controllers/cloudinary');
const auth = require('../middleware/auth');
const {
  createCard,
  getAllCards,
  getCardsCount,
  getCardById,
  updateCard,
  deleteCard,
  addCardDetails,
  updateCardDetail,
  deleteCardDetail
} = require('../controllers/cardController');

const router = express.Router();
const upload = multer({ storage });

// @route   POST /api/cards
// @desc    Create a new card
router.post('/cards', auth,upload.single('image'), createCard);

// @route   GET /api/cards
// @desc    Get all cards (public access for website)
router.get('/cards', getAllCards);

// @route   GET /api/cards/count
// @desc    Get cards count (public access for website)
router.get('/cards/count', getCardsCount);

// @route   GET /api/cards/:id
// @desc    Get a single card by ID (public access for website)
router.get('/cards/:id', getCardById);

// @route   PUT /api/cards/:id
// @desc    Update card details
router.put('/cards/:id', auth, upload.single('image'), updateCard);

// @route   DELETE /api/cards/:id
// @desc    Delete a card by ID
router.delete('/cards/:id', auth, deleteCard);

// @route   POST /api/cards/:id/carddetails
// @desc    Add images with description (flat array)
router.post('/cards/:id/carddetails', auth, upload.any(), addCardDetails);

// @route   PUT /api/cards/:id/carddetails/:detailId
// @desc    Update a specific card detail
router.put('/cards/:id/carddetails/:detailId', auth, upload.single('image'), updateCardDetail);

// @route   DELETE /api/cards/:id/carddetails/:detailId
// @desc    Delete a specific card detail
router.delete('/cards/:id/carddetails/:detailId', auth, deleteCardDetail);

module.exports = router;
