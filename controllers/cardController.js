const Card = require('../models/Card');
const { getOptimizedImageUrl, getResponsiveImageUrls } = require('./cloudinary');

// Helper to generate a unique card code
const generateCardCode = () => `ARX-${Math.floor(1000 + Math.random() * 9000)}`;

// Create a new card
const createCard = async (req, res) => {
  try {
    console.log('=== Card Creation Debug ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Request file:', req.file ? {
      filename: req.file.filename,
      path: req.file.path,
      mimetype: req.file.mimetype,
      size: req.file.size,
      originalname: req.file.originalname
    } : 'NO FILE');

    const { title, description, code } = req.body;
    const image = req.file?.path;

    if (!title) {
      console.log('❌ Missing title');
      return res.status(400).json({ message: 'Title is required' });
    }

    console.log('Creating card with:', { title, description, code, image });

    const newCard = new Card({
      code: code || generateCardCode(),
      title,
      description,
      image
    });

    await newCard.save();
    
    // Generate optimized image URLs if image exists
    if (newCard.image) {
      const publicId = newCard.image.split('/').pop().split('.')[0]; // Extract public_id from URL
      newCard.optimizedImages = getResponsiveImageUrls(publicId);
    }
    
    console.log('✅ Card created successfully:', newCard._id);
    res.status(201).json(newCard);
  } catch (err) {
    console.error('❌ Error creating card:', JSON.stringify(err, null, 2));
    res.status(500).json({ message: 'Error creating card', error: err.message });
  }
};

// Get all cards
const getAllCards = async (req, res) => {
  try {
    const cards = await Card.find();
    
    // Add optimized image URLs to each card
    const cardsWithOptimizedImages = cards.map(card => {
      const cardObj = card.toObject();
      if (cardObj.image) {
        try {
          // Extract public_id from Cloudinary URL
          const urlParts = cardObj.image.split('/');
          const publicIdWithExtension = urlParts[urlParts.length - 1];
          const publicId = publicIdWithExtension.split('.')[0];
          
          cardObj.optimizedImages = getResponsiveImageUrls(publicId);
        } catch (error) {
          console.warn('Could not generate optimized URLs for card:', cardObj._id, error.message);
        }
      }
      return cardObj;
    });
    
    res.json(cardsWithOptimizedImages);
  } catch (err) {
    console.error('Error fetching cards:', err);
    res.status(500).json({ message: 'Error fetching cards' });
  }
};

// Get cards count
const getCardsCount = async (req, res) => {
  try {
    const count = await Card.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error('Error fetching cards count:', err);
    res.status(500).json({ message: 'Error fetching cards count' });
  }
};

// Get a single card by ID
const getCardById = async (req, res) => {
  try {
    const card = await Card.findById(req.params.id);
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }
    
    // Add optimized image URLs if image exists
    const cardWithOptimizedImages = card.toObject();
    if (cardWithOptimizedImages.image) {
      cardWithOptimizedImages.optimizedImage = getOptimizedImageUrl(cardWithOptimizedImages.image);
      cardWithOptimizedImages.responsiveImages = getResponsiveImageUrls(cardWithOptimizedImages.image);
    }
    
    res.json(cardWithOptimizedImages);
  } catch (err) {
    console.error('Error fetching card:', err);
    res.status(500).json({ message: 'Error fetching card' });
  }
};

// Update card details
const updateCard = async (req, res) => {
  try {
    const { title, description } = req.body;
    const updateData = { title, description };

    if (req.file) {
      updateData.image = req.file.path;
    }

    const updatedCard = await Card.findByIdAndUpdate(req.params.id, updateData, { new: true });

    if (!updatedCard) {
      return res.status(404).json({ message: 'Card not found' });
    }

    res.json(updatedCard);
  } catch (err) {
    console.error('Error updating card:', err);
    res.status(500).json({ message: 'Error updating card', error: err.message });
  }
};

// Delete a card by ID
const deleteCard = async (req, res) => {
  try {
    const deletedCard = await Card.findByIdAndDelete(req.params.id);
    if (!deletedCard) {
      return res.status(404).json({ message: 'Card not found' });
    }
    res.json({ message: 'Card deleted successfully' });
  } catch (err) {
    console.error('Error deleting card:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Add card details (images with descriptions)
const addCardDetails = async (req, res) => {
  try {
    const card = await Card.findById(req.params.id);
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }

    const qs = require('qs');
    // ✅ Parse nested form keys using qs
    const parsedBody = qs.parse(req.body);

    const cardDetailsArray = [];

    req.files.forEach((file) => {
      const match = file.fieldname.match(/^carddetails\[(\d+)\]\[image\]$/);
      if (!match) return;

      const index = match[1];
      const description = parsedBody?.carddetails?.[index]?.description || '';

      cardDetailsArray.push({
        image: file.path,
        description,
      });
    });

    if (cardDetailsArray.length === 0) {
      return res.status(400).json({ message: 'No valid images found' });
    }

    card.carddetails.push(...cardDetailsArray);
    await card.save();

    res.json(card);
  } catch (err) {
    console.error('Error uploading carddetails:', err);
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
};

// Update a specific card detail
const updateCardDetail = async (req, res) => {
  try {
    const { id, detailId } = req.params;
    const { description } = req.body;
    
    const card = await Card.findById(id);
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }

    const cardDetail = card.carddetails.id(detailId);
    if (!cardDetail) {
      return res.status(404).json({ message: 'Card detail not found' });
    }

    // Update description
    if (description !== undefined) {
      cardDetail.description = description;
    }

    // Update image if provided
    if (req.file) {
      cardDetail.image = req.file.path;
    }

    await card.save();
    res.json(card);
  } catch (err) {
    console.error('Error updating card detail:', err);
    res.status(500).json({ message: 'Error updating card detail', error: err.message });
  }
};

// Delete a specific card detail
const deleteCardDetail = async (req, res) => {
  try {
    const { id, detailId } = req.params;
    
    const card = await Card.findById(id);
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }

    const cardDetail = card.carddetails.id(detailId);
    if (!cardDetail) {
      return res.status(404).json({ message: 'Card detail not found' });
    }

    cardDetail.deleteOne();
    await card.save();
    
    res.json({ message: 'Card detail deleted successfully', card });
  } catch (err) {
    console.error('Error deleting card detail:', err);
    res.status(500).json({ message: 'Error deleting card detail', error: err.message });
  }
};

module.exports = {
  createCard,
  getAllCards,
  getCardsCount,
  getCardById,
  updateCard,
  deleteCard,
  addCardDetails,
  updateCardDetail,
  deleteCardDetail
};
