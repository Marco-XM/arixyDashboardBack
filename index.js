require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bookingRoutes = require('./routes/bookingRoutes');
const reportRoutes = require('./routes/reportRoutes');
const userRoutes = require('./routes/userRoutes');
const blockedDateRoutes = require('./routes/blockedDateRoutes');
const eventsRoutes = require('./routes/eventsRoutes');
const cardRoutes = require('./routes/cardRoutes');
const marketingRoutes = require('./routes/marketingRoutes');

const app = express();
const port = 5000;

app.use(express.json());

app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'https://arixy-dashboard.vercel.app'],
    credentials: true
}));

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB connected!"))
.catch(err => console.error("MongoDB connection error:", err));

app.use('/api', bookingRoutes);
app.use('/api', reportRoutes);
app.use('/api', blockedDateRoutes);
app.use('/api', userRoutes);
app.use('/api', eventsRoutes);
app.use('/api', cardRoutes);
app.use('/api/marketing', marketingRoutes);

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
