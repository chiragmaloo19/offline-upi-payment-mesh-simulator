const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        mongoose.set('bufferCommands', false); // Fail fast if DB offline
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            // Optional: configurations for timeouts to not hang indefinitely
            serverSelectionTimeoutMS: 2000, 
        });
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`MongoDB Connection Error: ${error.message}`);
        // We do not process.exit(1) here so the app can start even if DB is down initially,
        // as per instructions: "Verify the MongoDB connection configuration does not crash the application when the database is not yet running; provide a clear error if connection fails."
    }
};

module.exports = connectDB;
