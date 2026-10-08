const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    packetHash: {
        type: String,
        required: true,
        unique: true,
    },
    senderVpa: {
        type: String,
        required: true,
    },
    receiverVpa: {
        type: String,
        required: true,
    },
    amount: {
        type: mongoose.Decimal128,
        required: true,
    },
    signedAt: {
        type: Date,
        required: true,
    },
    settledAt: {
        type: Date,
        required: true,
    },
    bridgeNodeId: {
        type: String,
        required: true,
    },
    hopCount: {
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: ['SETTLED', 'REJECTED'],
        required: true,
    }
}, {
    timestamps: true
});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
