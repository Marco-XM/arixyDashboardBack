const mongoose = require('mongoose');
require('dotenv').config();

async function fixEmailConfigIndexes() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    const db = mongoose.connection.db;
    const collection = db.collection('emailconfigs');
    
    // Get existing indexes
    const indexes = await collection.indexes();
    console.log('Existing indexes:', indexes);
    
    // Drop the old unique index on userId if it exists
    try {
      await collection.dropIndex('userId_1');
      console.log('Dropped old userId unique index');
    } catch (error) {
      console.log('userId unique index not found or already dropped');
    }
    
    // Create a compound unique index on userId and senderEmail
    // This allows multiple configs per user but prevents duplicate emails per user
    try {
      await collection.createIndex(
        { userId: 1, senderEmail: 1 }, 
        { unique: true, name: 'userId_senderEmail_unique' }
      );
      console.log('Created compound unique index on userId and senderEmail');
    } catch (error) {
      console.log('Compound index might already exist:', error.message);
    }
    
    // Verify new indexes
    const newIndexes = await collection.indexes();
    console.log('New indexes:', newIndexes);
    
  } catch (error) {
    console.error('Error fixing indexes:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the migration
fixEmailConfigIndexes();
