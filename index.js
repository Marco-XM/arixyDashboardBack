require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const userRoutes = require('./routes/userRoutes');
const cardRoutes = require('./routes/cardRoutes');
const marketingRoutes = require('./routes/marketingRoutes');
const contactRoutes = require('./routes/contactRoutes');
const clientRoutes = require('./routes/clientRoutes');

const app = express();
const port = 5000;

app.use(express.json());

app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'https://arixy-dashboard.vercel.app', 'https://www.arixy.tech', 'http://localhost:3000', 'https://arixy.vercel.app'],
    credentials: true
}));

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB connected!"))
.catch(err => console.error("MongoDB connection error:", err));

app.use('/api', userRoutes);
app.use('/api', cardRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api', contactRoutes);
app.use('/api/clients', clientRoutes);

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
