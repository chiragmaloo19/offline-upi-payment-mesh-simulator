const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
    vpa: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    holderName: {
        type: String,
        required: true,
        trim: true,
    },
    balance: {
        type: mongoose.Decimal128,
        required: true,
        default: 0.0,
    }
}, {
    timestamps: true,
    // Mongoose adds __v by default, which acts as the optimistic locking version key
    optimisticConcurrency: true
});

const Account = mongoose.model('Account', accountSchema);

module.exports = Account;
