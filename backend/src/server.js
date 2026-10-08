require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const Account = require('./models/Account');

const PORT = process.env.PORT || 5000;

// Connect to MongoDB without crashing if it fails
connectDB().then(async () => {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
        console.log('Skipping seed: Database not connected.');
        return;
    }
    try {
        const count = await Account.countDocuments();
        if (count === 0) {
            console.log('Seeding demo accounts...');
            await Account.insertMany([
                { vpa: 'alice@demo', holderName: 'Alice', balance: '10000.00' },
                { vpa: 'stranger1@demo', holderName: 'Stranger 1', balance: '5000.00' },
                { vpa: 'stranger2@demo', holderName: 'Stranger 2', balance: '5000.00' },
                { vpa: 'bob@demo', holderName: 'Bob', balance: '1000.00' },
            ]);
            console.log('Demo accounts seeded.');
        }
    } catch (e) {
        console.error('Failed to seed accounts:', e.message);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
