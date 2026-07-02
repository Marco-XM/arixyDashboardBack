const multer = require('multer');

// Express error-handling middleware (4 args) that converts Multer upload errors
// into clean 400 JSON responses instead of an unhandled 500 + stack trace.
// Place it in a route chain immediately after the multer middleware.
const handleUploadError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? 'File too large. Each file must be 25MB or less.'
            : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
                ? 'Too many files uploaded.'
                : `Upload error: ${err.message}`;
        return res.status(400).json({ success: false, message });
    }
    if (err) {
        return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
    }
    next();
};

module.exports = handleUploadError;
