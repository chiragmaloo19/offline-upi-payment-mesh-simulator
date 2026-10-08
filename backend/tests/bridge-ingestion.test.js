/**
 * Bridge Ingestion Service Tests
 *
 * Strategy:
 * - Real crypto.service and idempotency.service are used (no mocks).
 *   This tests the real encryption, hashing, and idempotency claim logic.
 * - settlement.service is mocked because it requires a real MongoDB session.
 *   Tests verify that settlement is called with the correct arguments, or
 *   that it is NOT called when it should not be.
 */

const cryptoService = require('../src/services/crypto.service');
const idempotencyService = require('../src/services/idempotency.service');

// Mock settlement before requiring ingestion so the module gets the mock
jest.mock('../src/services/settlement.service');
const settlementService = require('../src/services/settlement.service');

const { bridgeIngestionService, MAX_AGE_SECONDS, MAX_FUTURE_SECONDS } = require('../src/services/bridge-ingestion.service');

// Helper: build a valid encrypted packet
function buildPacket(overrides = {}) {
    const instruction = {
        senderVpa: 'alice@demo',
        receiverVpa: 'bob@demo',
        amount: '100.00',
        pinHash: 'hash123',
        nonce: Math.random().toString(36).slice(2), // unique per test
        signedAt: Date.now(),
        ...overrides.instruction
    };
    const ciphertext = cryptoService.encryptPayment(instruction);
    return { packet: { ciphertext }, instruction };
}

// Mock a settled transaction response from settlement service
function mockSettledTx(status = 'SETTLED') {
    return {
        _id: 'mock-tx-id',
        status,
        packetHash: 'some-hash',
    };
}

describe('Bridge Ingestion Service Tests', () => {

    beforeEach(() => {
        idempotencyService.clear();
        jest.clearAllMocks();
    });

    afterAll(() => {
        // Stop internal idempotency timer so Jest can exit cleanly
        clearInterval(idempotencyService.interval);
    });

    // -------------------------------------------------------------------------
    test('1. Valid payment — full happy path', async () => {
        const { packet, instruction } = buildPacket();
        
        settlementService.settle.mockResolvedValue(mockSettledTx('SETTLED'));

        const result = await bridgeIngestionService.ingest(packet, 'bridge-1', 3);

        expect(result.outcome).toBe('SETTLED');
        expect(result.packetHash).toBeTruthy();
        expect(result.transactionId).toBe('mock-tx-id');

        // Verify settlement was called with the correct instruction fields
        expect(settlementService.settle).toHaveBeenCalledTimes(1);
        const [calledInstruction, calledHash, calledBridge, calledHops] =
            settlementService.settle.mock.calls[0];

        expect(calledInstruction.senderVpa).toBe(instruction.senderVpa);
        expect(calledInstruction.receiverVpa).toBe(instruction.receiverVpa);
        expect(calledInstruction.amount).toBe(instruction.amount);
        expect(calledHash).toBe(cryptoService.hashCiphertext(packet.ciphertext));
        expect(calledBridge).toBe('bridge-1');
        expect(calledHops).toBe(3);
    });

    // -------------------------------------------------------------------------
    test('2. Duplicate packet — DUPLICATE_DROPPED, crypto and settlement NOT called', async () => {
        const { packet } = buildPacket();
        
        settlementService.settle.mockResolvedValue(mockSettledTx('SETTLED'));

        // First call
        await bridgeIngestionService.ingest(packet, 'bridge-1', 2);

        jest.clearAllMocks(); // reset call counts
        const decryptSpy = jest.spyOn(cryptoService, 'decryptPayment');

        // Second call — same packet, same ciphertext
        const result = await bridgeIngestionService.ingest(packet, 'bridge-1', 2);

        expect(result.outcome).toBe('DUPLICATE_DROPPED');
        expect(decryptSpy).not.toHaveBeenCalled();  // must not decrypt on duplicate
        expect(settlementService.settle).not.toHaveBeenCalled();

        decryptSpy.mockRestore();
    });

    // -------------------------------------------------------------------------
    test('3. Tampered packet — INVALID, settlement NOT called', async () => {
        const { packet } = buildPacket();

        // Flip a byte in the ciphertext (well past the RSA block)
        const buf = Buffer.from(packet.ciphertext, 'base64');
        buf[300] = buf[300] ^ 0xff;
        const tamperedPacket = { ciphertext: buf.toString('base64') };

        const result = await bridgeIngestionService.ingest(tamperedPacket, 'bridge-1', 1);

        expect(result.outcome).toBe('INVALID');
        expect(result.reason).toBe('decryption_failed');
        expect(settlementService.settle).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    test('4. Expired payment — stale_packet, settlement NOT called', async () => {
        // Encrypt with a signedAt > 24h ago
        const oldSignedAt = Date.now() - (MAX_AGE_SECONDS + 3600) * 1000; // 25h ago
        const { packet } = buildPacket({ instruction: { signedAt: oldSignedAt } });

        const result = await bridgeIngestionService.ingest(packet, 'bridge-1', 1);

        expect(result.outcome).toBe('INVALID');
        expect(result.reason).toBe('stale_packet');
        expect(settlementService.settle).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    test('5. Valid recent payment — freshness passes, settlement called', async () => {
        // signedAt = 10 seconds ago — well within 24h window
        const { packet } = buildPacket({ instruction: { signedAt: Date.now() - 10_000 } });
        
        settlementService.settle.mockResolvedValue(mockSettledTx('SETTLED'));

        const result = await bridgeIngestionService.ingest(packet, 'bridge-2', 1);

        expect(result.outcome).toBe('SETTLED');
        expect(settlementService.settle).toHaveBeenCalledTimes(1);
    });

    // -------------------------------------------------------------------------
    test('6. Future-dated packet beyond clock-skew — future_dated, settlement NOT called', async () => {
        // signedAt = 10 minutes in future, beyond the 5-minute tolerance
        const futureSignedAt = Date.now() + (MAX_FUTURE_SECONDS + 600) * 1000;
        const { packet } = buildPacket({ instruction: { signedAt: futureSignedAt } });

        const result = await bridgeIngestionService.ingest(packet, 'bridge-1', 1);

        expect(result.outcome).toBe('INVALID');
        expect(result.reason).toBe('future_dated');
        expect(settlementService.settle).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    test('7. Settlement returns REJECTED (insufficient funds) — propagated as REJECTED', async () => {
        const { packet } = buildPacket();
        
        settlementService.settle.mockResolvedValue(mockSettledTx('REJECTED'));

        const result = await bridgeIngestionService.ingest(packet, 'bridge-1', 1);

        expect(result.outcome).toBe('REJECTED');
        expect(result.reason).toBe('insufficient_funds');
        expect(settlementService.settle).toHaveBeenCalledTimes(1);
    });

    // -------------------------------------------------------------------------
    test('8. Ordering — duplicate detection happens BEFORE decryption', async () => {
        const { packet } = buildPacket();

        // Pre-claim the hash so it is already in the cache
        const hash = cryptoService.hashCiphertext(packet.ciphertext);
        idempotencyService.claim(hash);

        const decryptSpy = jest.spyOn(cryptoService, 'decryptPayment');

        const result = await bridgeIngestionService.ingest(packet, 'bridge-1', 1);

        expect(result.outcome).toBe('DUPLICATE_DROPPED');
        // decryptPayment must NOT have been called at all
        expect(decryptSpy).not.toHaveBeenCalled();

        decryptSpy.mockRestore();
    });

    // -------------------------------------------------------------------------
    test('9. Idempotency claim NOT released after decryption failure (tampered packet stays claimed)', async () => {
        const { packet } = buildPacket();

        // Tamper after building valid packet
        const buf = Buffer.from(packet.ciphertext, 'base64');
        buf[300] = buf[300] ^ 0xff;
        const tamperedPacket = { ciphertext: buf.toString('base64') };

        // First attempt — should be INVALID
        const result1 = await bridgeIngestionService.ingest(tamperedPacket, 'bridge-1', 1);
        expect(result1.outcome).toBe('INVALID');

        // Second attempt — same tampered ciphertext → same hash → DUPLICATE_DROPPED
        // (claim was NOT released, so it stays claimed)
        const result2 = await bridgeIngestionService.ingest(tamperedPacket, 'bridge-1', 1);
        expect(result2.outcome).toBe('DUPLICATE_DROPPED');

        // Settlement must never have been called across both attempts
        expect(settlementService.settle).not.toHaveBeenCalled();
    });
});
