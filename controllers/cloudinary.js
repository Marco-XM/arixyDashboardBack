const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const dotenv = require('dotenv');
dotenv.config();

// Verify environment variables are loaded
console.log('Cloudinary Config Check:', {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME ? '✓ SET' : '❌ MISSING',
  api_key: process.env.CLOUDINARY_API_KEY ? '✓ SET' : '❌ MISSING',
  api_secret: process.env.CLOUDINARY_API_SECRET ? '✓ SET' : '❌ MISSING'
});

// Test Cloudinary connection
const testCloudinaryConnection = async () => {
  try {
    await cloudinary.api.ping();
    console.log('✅ Cloudinary connection successful');
  } catch (error) {
    console.error('❌ Cloudinary connection failed:', error.message);
  }
};

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Test the connection
testCloudinaryConnection();

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'cms_cards',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    // Upload in full quality
    quality: 'auto:best',
    // Enable automatic format optimization
    format: 'auto',
    // Preserve original quality on upload
    flags: 'preserve_transparency',
    public_id: (req, file) => {
      console.log('Card upload - generating public_id for:', file.originalname);
      return 'card_' + Date.now();
    },
    // Additional transformation for optimization
    transformation: [
      {
        quality: 'auto:best',
        fetch_format: 'auto',
        flags: 'progressive'
      }
    ]
  },
});

const clientStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'client_logos',
    allowed_formats: ['jpg', 'jpeg', 'png', 'svg', 'webp'],
    // Upload in full quality
    quality: 'auto:best',
    // Enable automatic format optimization
    format: 'auto',
    // Preserve original quality on upload
    flags: 'preserve_transparency',
    public_id: (req, file) => {
      console.log('Client upload - generating public_id for:', file.originalname);
      return 'client_' + Date.now();
    },
    // Additional transformation for optimization
    transformation: [
      {
        quality: 'auto:best',
        fetch_format: 'auto',
        flags: 'progressive'
      }
    ]
  },
});

// Utility functions for optimized image URLs
const getOptimizedImageUrl = (publicId, options = {}) => {
  const {
    width = 'auto',
    height = 'auto',
    quality = 'auto:best',
    format = 'auto',
    crop = 'fill',
    gravity = 'auto'
  } = options;

  return cloudinary.url(publicId, {
    width,
    height,
    quality,
    format,
    crop,
    gravity,
    fetch_format: 'auto',
    flags: 'progressive'
  });
};

// Predefined image transformations for common use cases
const imageTransformations = {
  // Thumbnail - small, optimized for lists
  thumbnail: {
    width: 300,
    height: 200,
    crop: 'fill',
    quality: 'auto:good',
    format: 'auto'
  },
  
  // Medium - for cards and previews
  medium: {
    width: 600,
    height: 400,
    crop: 'fill',
    quality: 'auto:good',
    format: 'auto'
  },
  
  // Large - for detail views
  large: {
    width: 1200,
    height: 800,
    crop: 'fill',
    quality: 'auto:best',
    format: 'auto'
  },
  
  // Hero - for hero sections and banners
  hero: {
    width: 1920,
    height: 1080,
    crop: 'fill',
    quality: 'auto:best',
    format: 'auto'
  },
  
  // Logo - for client logos (preserve aspect ratio)
  logo: {
    height: 200,
    crop: 'fit',
    quality: 'auto:best',
    format: 'auto',
    background: 'transparent'
  }
};

// Generate multiple sizes for responsive images
const getResponsiveImageUrls = (publicId) => {
  return {
    thumbnail: getOptimizedImageUrl(publicId, imageTransformations.thumbnail),
    medium: getOptimizedImageUrl(publicId, imageTransformations.medium),
    large: getOptimizedImageUrl(publicId, imageTransformations.large),
    hero: getOptimizedImageUrl(publicId, imageTransformations.hero),
    original: getOptimizedImageUrl(publicId, { quality: 'auto:best', format: 'auto' })
  };
};

module.exports = { 
  cloudinary, 
  storage, 
  clientStorage, 
  getOptimizedImageUrl, 
  getResponsiveImageUrls,
  imageTransformations 
};
