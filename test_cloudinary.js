// Test script to verify Cloudinary optimization is working
const { getOptimizedImageUrl, getResponsiveImageUrls } = require('./controllers/cloudinary');

// Test with a sample Cloudinary URL
const sampleImageUrl = 'https://res.cloudinary.com/your-cloud-name/image/upload/v1234567890/sample.jpg';

console.log('🧪 Testing Cloudinary Optimization...\n');

// Test optimized image URL
console.log('📸 Original Image URL:');
console.log(sampleImageUrl);

console.log('\n✨ Optimized Image URL (WebP, quality auto:best):');
console.log(getOptimizedImageUrl(sampleImageUrl));

console.log('\n📱 Responsive Image URLs:');
const responsiveUrls = getResponsiveImageUrls(sampleImageUrl);
Object.entries(responsiveUrls).forEach(([size, url]) => {
  console.log(`  ${size}: ${url}`);
});

console.log('\n🎯 Benefits:');
console.log('• Automatic WebP conversion for better compression');
console.log('• Quality optimization while preserving visual quality');
console.log('• Responsive images for different screen sizes');
console.log('• Faster loading times and better SEO performance');
