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
    allowed_formats: ['jpg', 'jpeg', 'png'],
    public_id: (req, file) => {
      console.log('Card upload - generating public_id for:', file.originalname);
      return 'card_' + Date.now();
    }
  },
});

const clientStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'client_logos',
    allowed_formats: ['jpg', 'jpeg', 'png', 'svg', 'webp'],
    public_id: (req, file) => {
      console.log('Client upload - generating public_id for:', file.originalname);
      return 'client_' + Date.now();
    }
  },
});

module.exports = { cloudinary, storage, clientStorage };
