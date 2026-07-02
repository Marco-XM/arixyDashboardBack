require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./db');
const userRoutes = require('./routes/userRoutes');
const cardRoutes = require('./routes/cardRoutes');
const blogRoutes = require('./routes/blogRoutes');
const marketingRoutes = require('./routes/marketingRoutes');
const contactRoutes = require('./routes/contactRoutes');
const clientRoutes = require('./routes/clientRoutes');
const companyRoutes = require('./routes/companyRoutes');
const templateRoutes = require('./routes/templateRoutes');
const documentRoutes = require('./routes/documentRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const financeRoutes = require('./routes/financeRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const signatureRoutes = require('./routes/signatureRoutes');

const app = express();
const port = 5000;

// Raised body limits so large email HTML (pasted/base64 inline images) and
// attachment-bearing template/send payloads aren't rejected with a 413 before
// reaching the route (the default 100kb limit silently broke "Save as Template").
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

const allowedOrigins = [
    'https://arixy-dashboard.vercel.app',
    'https://www.arixytech.com',
    'https://arixytech.com',
    'https://admin.arixytech.com',
    'https://www.arixy.tech',
    'https://arixy.vercel.app',
];
app.use(cors({
    // Allow the production whitelist plus any localhost/127.0.0.1 port (dev) and
    // non-browser requests (no Origin header). Keeps prod origins explicit.
    origin: (origin, cb) => {
        if (!origin
            || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
            || allowedOrigins.includes(origin)) {
            return cb(null, true);
        }
        return cb(null, false);
    },
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
app.use('/api', blogRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api', contactRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/contract-templates', templateRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/signatures', signatureRoutes);

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
