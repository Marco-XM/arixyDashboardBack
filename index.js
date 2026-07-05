require('dotenv').config();
const express = require('express');
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
const sitemapRoutes = require('./routes/sitemapRoutes');
const siteRoutes = require('./routes/siteRoutes');

const app = express();
const port = 5000;

const allowedOrigins = [
    'https://arixy-dashboard.vercel.app',
    'https://www.arixytech.com',
    'https://arixytech.com',
    'https://admin.arixytech.com',
    'https://www.arixy.tech',
    'https://arixy.vercel.app',
];

// Production whitelist plus any localhost/127.0.0.1 port (dev). Non-browser
// requests (no Origin header) need no CORS headers at all.
const isAllowedOrigin = (origin) =>
    !!origin && (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
        || allowedOrigins.includes(origin));

// CORS headers are set as the VERY FIRST middleware so that every response —
// including body-parser 413s, DB 503s and unhandled 500s below — carries them.
// A response without these headers is reported by browsers as a misleading
// "blocked by CORS policy" even when the real failure is a server error.
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers',
            req.headers['access-control-request-headers'] || 'Authorization,Content-Type');
    }
    // The CORS header varies by Origin, so caches must never reuse a response
    // from one site for another.
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
});

// Raised body limits so large email HTML (pasted/base64 inline images) and
// attachment-bearing template/send payloads aren't rejected with a 413 before
// reaching the route (the default 100kb limit silently broke "Save as Template").
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

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

// Live sitemap for the public website (proxied from arixy.tech/sitemap.xml).
app.use('/', sitemapRoutes);

app.use('/api', userRoutes);
app.use('/api', cardRoutes);
app.use('/api', blogRoutes);
app.use('/api', siteRoutes);
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

// Last-resort error handler: return JSON instead of letting Express/the
// platform emit a header-less error page (CORS headers were already set by
// the first middleware, so the browser reports the real status code).
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
