const Card = require('../models/Card');
const { getOptimizedImageUrl, getResponsiveImageUrls } = require('./cloudinary');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');

// Helper to generate a unique card code
const generateCardCode = () => `ARX-${Math.floor(1000 + Math.random() * 9000)}`;

// Normalize an array-like field that may arrive as a JSON string, a
// comma-separated string, an array, or be absent.
const parseArrayField = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.filter((v) => String(v).trim() !== '');
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed);
        return Array.isArray(arr) ? arr.filter((v) => String(v).trim() !== '') : undefined;
      } catch (e) {
        /* fall through to comma split */
      }
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
};

// Collect uploaded files for a given multer field (works with upload.fields).
const filesFor = (req, field) =>
  (req.files && (Array.isArray(req.files) ? req.files.filter((f) => f.fieldname === field) : req.files[field])) || [];

// Pull the single main image path from either upload.single or upload.fields.
const mainImagePath = (req) => {
  if (req.file) return req.file.path;
  const arr = filesFor(req, 'image');
  return arr[0]?.path;
};

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

    const {
      title, title_ar, description, description_ar, summary, summary_ar,
      code, client, year, liveUrl, featured, slug,
    } = req.body;
    const image = mainImagePath(req);

    if (!title) {
      console.log('❌ Missing title');
      return res.status(400).json({ message: 'Title is required' });
    }

    // Generate a unique slug from the provided slug or the title.
    const baseSlug = slugify(slug || title) || `project-${Date.now()}`;
    const uniqueSlug = await ensureUniqueSlug(Card, baseSlug);

    const gallery = filesFor(req, 'gallery').map((f) => f.path);

    const newCard = new Card({
      code: code || generateCardCode(),
      slug: uniqueSlug,
      title,
      title_ar,
      description,
      description_ar,
      summary,
      summary_ar,
      image,
      client,
      year,
      liveUrl,
      featured: featured === 'true' || featured === true,
      services: parseArrayField(req.body.services),
      technologies: parseArrayField(req.body.technologies),
      gallery: gallery.length ? gallery : undefined,
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
    const card = await Card.findById(req.params.id);
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }

    const body = req.body;
    const assignIfPresent = (field) => {
      if (body[field] !== undefined) card[field] = body[field];
    };
    ['title', 'title_ar', 'description', 'description_ar', 'summary', 'summary_ar',
      'client', 'year', 'liveUrl'].forEach(assignIfPresent);

    if (body.featured !== undefined) card.featured = body.featured === 'true' || body.featured === true;
    const services = parseArrayField(body.services);
    if (services !== undefined) card.services = services;
    const technologies = parseArrayField(body.technologies);
    if (technologies !== undefined) card.technologies = technologies;

    // Keep / (re)generate slug. If a slug is explicitly provided, honor it;
    // otherwise generate one if the card doesn't already have a stable slug.
    if (body.slug) {
      card.slug = await ensureUniqueSlug(Card, slugify(body.slug), card._id);
    } else if (!card.slug && card.title) {
      card.slug = await ensureUniqueSlug(Card, slugify(card.title) || `project-${Date.now()}`, card._id);
    }

    const newMain = mainImagePath(req);
    if (newMain) card.image = newMain;

    // Append any newly uploaded gallery images.
    const newGallery = filesFor(req, 'gallery').map((f) => f.path);
    if (newGallery.length) card.gallery = [...(card.gallery || []), ...newGallery];

    // Allow replacing the gallery wholesale via a JSON array of URLs to keep.
    const keepGallery = parseArrayField(body.gallery);
    if (keepGallery !== undefined && !newGallery.length) card.gallery = keepGallery;

    await card.save();
    res.json(card);
  } catch (err) {
    console.error('Error updating card:', err);
    res.status(500).json({ message: 'Error updating card', error: err.message });
  }
};

// Get a single card by slug (public, for the website project page)
const getCardBySlug = async (req, res) => {
  try {
    const card = await Card.findOne({ slug: req.params.slug });
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }
    res.json(card);
  } catch (err) {
    console.error('Error fetching card by slug:', err);
    res.status(500).json({ message: 'Error fetching card' });
  }
};

// Backfill slugs for existing cards that don't have one (admin maintenance).
const backfillSlugs = async (req, res) => {
  try {
    const cards = await Card.find({ $or: [{ slug: { $exists: false } }, { slug: null }, { slug: '' }] });
    let updated = 0;
    for (const card of cards) {
      card.slug = await ensureUniqueSlug(Card, slugify(card.title) || `project-${card._id}`, card._id);
      await card.save();
      updated += 1;
    }
    res.json({ message: `Backfilled ${updated} slug(s)`, updated });
  } catch (err) {
    console.error('Error backfilling slugs:', err);
    res.status(500).json({ message: 'Error backfilling slugs', error: err.message });
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
      const detail = parsedBody?.carddetails?.[index] || {};

      cardDetailsArray.push({
        image: file.path,
        title: detail.title || '',
        title_ar: detail.title_ar || '',
        description: detail.description || '',
        description_ar: detail.description_ar || '',
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
    const { description, description_ar, title, title_ar } = req.body;

    const card = await Card.findById(id);
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }

    const cardDetail = card.carddetails.id(detailId);
    if (!cardDetail) {
      return res.status(404).json({ message: 'Card detail not found' });
    }

    // Update fields if provided
    if (description !== undefined) cardDetail.description = description;
    if (description_ar !== undefined) cardDetail.description_ar = description_ar;
    if (title !== undefined) cardDetail.title = title;
    if (title_ar !== undefined) cardDetail.title_ar = title_ar;

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
  getCardBySlug,
  backfillSlugs,
  updateCard,
  deleteCard,
  addCardDetails,
  updateCardDetail,
  deleteCardDetail
};
