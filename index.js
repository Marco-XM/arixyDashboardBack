require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./db');
const userRoutes = require('./routes/userRoutes');
const cardRoutes = require('./routes/cardRoutes');
const marketingRoutes = require('./routes/marketingRoutes');
const contactRoutes = require('./routes/contactRoutes');
const clientRoutes = require('./routes/clientRoutes');

const app = express();
const port = 5000;

app.use(express.json());

app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'https://arixy-dashboard.vercel.app', 'https://www.arixytech.com', 'https://arixytech.com', 'https://www.arixy.tech', 'http://localhost:3000', 'https://arixy.vercel.app'],
    credentials: true
}));

// Ensure a live DB connection before any route/query runs. On serverless this
// prevents queries from being buffered against a cold/stale connection (which
// surfaced as "Operation ...findOne() buffering timed out after 10000ms" and
// cascaded into spurious 401s / logouts).
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error("MongoDB connection error:", err);
        res.status(503).json({ error: 'Database temporarily unavailable, please try again.' });
    }
});

app.use('/api', userRoutes);
app.use('/api', cardRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api', contactRoutes);
app.use('/api/clients', clientRoutes);

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
