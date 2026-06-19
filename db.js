const mongoose = require('mongoose');

// Cache the connection across warm serverless invocations (Vercel freezes and
// reuses the container, so we must not open a new connection on every request).
let cached = global._mongoose;
if (!cached) {
    cached = global._mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
    // readyState 1 === connected. If we previously connected but the socket has
    // since dropped (idle timeout on a frozen container), fall through and reconnect.
    if (cached.conn && mongoose.connection.readyState === 1) {
        return cached.conn;
    }

    if (!cached.promise) {
        if (!process.env.MONGO_URI) {
            throw new Error('MONGO_URI is not defined');
        }

        cached.promise = mongoose.connect(process.env.MONGO_URI, {
            // Fail fast instead of silently buffering a query for 10s and then
            // throwing the misleading "buffering timed out" error.
            bufferCommands: false,
            serverSelectionTimeoutMS: 8000,
            // Keep the pool small and short-lived; serverless wants few, fresh sockets.
            maxPoolSize: 10,
        });
    }

    try {
        cached.conn = await cached.promise;
    } catch (err) {
        // Reset so the next request retries instead of reusing a rejected promise.
        cached.promise = null;
        throw err;
    }

    return cached.conn;
};

module.exports = connectDB;
