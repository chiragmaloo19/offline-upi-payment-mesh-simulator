const cryptoService = require('./crypto.service');
const idempotencyService = require('./idempotency.service');
const settlementService = require('./settlement.service');

/**
 * Orchestrates the full server-side pipeline for one inbound packet from a
 * bridge node, faithfully mirroring BridgeIngestionService.java:
 *
 *   1. Hash the ciphertext.
 *   2. Try to claim that hash via the idempotency cache.
 *      - If already claimed: this is a duplicate. Drop it.
 *   3. Decrypt the ciphertext with the server's private key.
 *      - If decryption fails: tampered or junk. Reject. Claim is NOT released.
 *   4. Check freshness — reject if signedAt is too old (replay protection)
 *      or more than 5 minutes in the future (clock-skew tolerance).
 *      Claim is NOT released on rejection.
 *   5. Hand off to SettlementService for the actual debit/credit.
 *
 * Reference: BridgeIngestionService.java (upi.mesh.packet-max-age-seconds: 86400)
 */

/** Maximum packet age in seconds before it is considered stale (24h). */
const MAX_AGE_SECONDS = 86400;

/** Maximum forward clock-skew tolerance in seconds (5 minutes). */
const MAX_FUTURE_SECONDS = 300;

class IngestResult {
    constructor(outcome, packetHash, reason, transactionId, transaction) {
        this.outcome = outcome;
        this.packetHash = packetHash;
        this.reason = reason || null;
        this.transactionId = transactionId || null;
        this.transaction = transaction || null;
    }

    static settled(packetHash, tx) {
        return new IngestResult('SETTLED', packetHash, null, tx._id ? tx._id.toString() : null, tx);
    }

    static rejected(packetHash, tx) {
        return new IngestResult('REJECTED', packetHash, 'insufficient_funds', tx._id ? tx._id.toString() : null, tx);
    }

    static duplicate(packetHash) {
        return new IngestResult('DUPLICATE_DROPPED', packetHash, null, null, null);
    }

    static invalid(packetHash, reason) {
        return new IngestResult('INVALID', packetHash, reason, null, null);
    }
}

class BridgeIngestionService {
    /**
     * @param {Object} packet         { ciphertext: string, packetId?: string, ttl?: number, createdAt?: number }
     * @param {string} bridgeNodeId   Identifier of the bridge node forwarding this packet
     * @param {number} hopCount       Number of mesh hops this packet has taken
     * @returns {IngestResult}
     */
    async ingest(packet, bridgeNodeId, hopCount) {
        try {
            const { ciphertext } = packet;

            // ---- 1. Hash the ciphertext ----
            const packetHash = cryptoService.hashCiphertext(ciphertext);

            // ---- 2. Idempotency gate ----
            // claim() is synchronous and atomic within this Node process.
            // Returns false if already claimed (duplicate).
            if (!idempotencyService.claim(packetHash)) {
                return IngestResult.duplicate(packetHash);
            }

            // ---- 3. Decrypt ----
            // NOTE: If decryption fails, the idempotency claim is NOT released.
            // This matches the Java reference exactly. A tampered/malformed packet
            // stays claimed to prevent replay abuse with different outer fields.
            let instruction;
            try {
                instruction = cryptoService.decryptPayment(ciphertext);
            } catch (e) {
                return IngestResult.invalid(packetHash, 'decryption_failed');
            }

            // ---- 4. Freshness / replay protection ----
            // Java reference: (Instant.now().toEpochMilli() - instruction.getSignedAt()) / 1000
            // Reject if older than maxAgeSeconds (86400 = 24h)
            // Reject if more than 300 seconds in the future (5-minute clock-skew tolerance)
            const signedAt = instruction.signedAt;
            if (signedAt == null || typeof signedAt !== 'number' || isNaN(signedAt)) {
                return IngestResult.invalid(packetHash, 'missing_or_invalid_timestamp');
            }

            const ageSeconds = (Date.now() - signedAt) / 1000;

            if (ageSeconds > MAX_AGE_SECONDS) {
                return IngestResult.invalid(packetHash, 'stale_packet');
            }
            if (ageSeconds < -MAX_FUTURE_SECONDS) {
                return IngestResult.invalid(packetHash, 'future_dated');
            }

            // ---- 5. Settle ----
            const tx = await settlementService.settle(instruction, packetHash, bridgeNodeId, hopCount);

            // Settlement can result in SETTLED or REJECTED (insufficient funds)
            if (tx.status === 'REJECTED') {
                return IngestResult.rejected(packetHash, tx);
            }
            return IngestResult.settled(packetHash, tx);

        } catch (e) {
            return IngestResult.invalid('?', 'internal_error: ' + e.message);
        }
    }
}

module.exports = {
    bridgeIngestionService: new BridgeIngestionService(),
    IngestResult,
    MAX_AGE_SECONDS,
    MAX_FUTURE_SECONDS,
};
