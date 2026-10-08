const mongoose = require('mongoose');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');

class SettlementService {
    /**
     * Executes the settlement process inside a MongoDB transaction.
     * 
     * @param {Object} instruction { senderVpa, receiverVpa, amount, signedAt }
     * @param {string} packetHash 
     * @param {string} bridgeNodeId 
     * @param {number} hopCount 
     * @returns {Promise<Transaction>} The resulting transaction record
     */
    async settle(instruction, packetHash, bridgeNodeId, hopCount) {
        const session = await mongoose.startSession();
        let resultTx;

        try {
            await session.withTransaction(async () => {
                const amount = parseFloat(instruction.amount);

                if (isNaN(amount) || amount <= 0) {
                    throw new Error('Amount must be positive');
                }

                // Look up sender
                const sender = await Account.findOne({ vpa: instruction.senderVpa }).session(session);
                if (!sender) {
                    throw new Error(`Unknown sender VPA: ${instruction.senderVpa}`);
                }

                // Look up receiver
                const receiver = await Account.findOne({ vpa: instruction.receiverVpa }).session(session);
                if (!receiver) {
                    throw new Error(`Unknown receiver VPA: ${instruction.receiverVpa}`);
                }

                // Duplicate packet hash check
                const existingTx = await Transaction.findOne({ packetHash }).session(session);
                if (existingTx) {
                    throw new Error(`Duplicate packetHash: ${packetHash}`);
                }

                const senderBalance = parseFloat(sender.balance.toString());

                // Insufficient balance handling
                if (senderBalance < amount) {
                    resultTx = new Transaction({
                        packetHash,
                        senderVpa: instruction.senderVpa,
                        receiverVpa: instruction.receiverVpa,
                        amount: amount,
                        signedAt: new Date(instruction.signedAt),
                        settledAt: new Date(),
                        bridgeNodeId,
                        hopCount,
                        status: 'REJECTED'
                    });
                    await resultTx.save({ session });
                    return; // Graceful rejection recorded, transaction commits
                }

                // Optimistic locking / Concurrency
                // If sender and receiver are the SAME account, Mongoose will throw a VersionError
                // if we try to save both instances (they have the same _id and same __v). 
                // We handle it gracefully by just updating the one instance.
                if (sender.vpa === receiver.vpa) {
                    // Net balance change is 0, but we still trigger a save to increment version 
                    // and ensure optimistic locking triggers correctly on concurrent runs.
                    sender.balance = senderBalance;
                    await sender.save({ session });
                } else {
                    const receiverBalance = parseFloat(receiver.balance.toString());
                    sender.balance = senderBalance - amount;
                    receiver.balance = receiverBalance + amount;

                    // Mongoose handles optimistic locking via the __v key configured in the schema
                    await sender.save({ session });
                    await receiver.save({ session });
                }

                // Record successful transaction
                resultTx = new Transaction({
                    packetHash,
                    senderVpa: instruction.senderVpa,
                    receiverVpa: instruction.receiverVpa,
                    amount: amount,
                    signedAt: new Date(instruction.signedAt),
                    settledAt: new Date(),
                    bridgeNodeId,
                    hopCount,
                    status: 'SETTLED'
                });
                await resultTx.save({ session });
            });
        } finally {
            session.endSession();
        }

        return resultTx;
    }
}

module.exports = new SettlementService();
