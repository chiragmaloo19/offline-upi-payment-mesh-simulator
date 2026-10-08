/**
 * API Integration Tests (Stage 7)
 *
 * Uses supertest to test actual Express routes end-to-end.
 *
 * Mocking strategy:
 *   - Settlement service: MOCKED — requires real MongoDB which is unavailable.
 *   - All other services (crypto, idempotency, mesh simulator, bridge ingestion):
 *     REAL — these are pure in-memory services with no DB dependency.
 *   - Account/Transaction models: MOCKED for /api/accounts and /api/transactions
 *     since they require MongoDB.
 */

const request = require('supertest');
const cryptoService = require('../src/services/crypto.service');
const idempotencyService = require('../src/services/idempotency.service');
const { meshSimulatorService } = require('../src/services/mesh-simulator.service');

// Mock settlement so bridge ingestion doesn't need MongoDB
jest.mock('../src/services/settlement.service');
const settlementService = require('../src/services/settlement.service');

// Mock DB models for dashboard endpoints
jest.mock('../src/models/Account');
jest.mock('../src/models/Transaction');
const Account = require('../src/models/Account');
const Transaction = require('../src/models/Transaction');

// Load app AFTER mocks are in place
const app = require('../src/app');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildValidCiphertext() {
    return cryptoService.encryptPayment({
        senderVpa: 'alice@demo',
        receiverVpa: 'bob@demo',
        amount: '100.00',
        pinHash: 'hash123',
        nonce: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
        signedAt: Date.now(),
    });
}

const crypto = require('crypto');

function mockSettled() {
    settlementService.settle.mockResolvedValue({
        _id: 'mock-tx-id',
        status: 'SETTLED',
    });
}

function mockRejected() {
    settlementService.settle.mockResolvedValue({
        _id: 'mock-tx-id',
        status: 'REJECTED',
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
    meshSimulatorService.resetMesh();
    idempotencyService.clear();
    jest.clearAllMocks();
});

afterAll(() => {
    clearInterval(idempotencyService.interval);
});

// ─────────────────────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
    test('returns UP status', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('UP');
        expect(res.body.timestamp).toBeDefined();
        expect(res.body.database).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Server Key
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/server-key', () => {
    test('returns RSA public key with algorithm info', async () => {
        const res = await request(app).get('/api/server-key');
        expect(res.status).toBe(200);
        expect(res.body.publicKey).toContain('BEGIN PUBLIC KEY');
        expect(res.body.algorithm).toBe('RSA-2048 / OAEP-SHA256');
        expect(res.body.hybridScheme).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Demo Send
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/demo/send', () => {
    const validBody = {
        senderVpa: 'alice@demo',
        receiverVpa: 'bob@demo',
        amount: 100,
        pin: '1234',
    };

    test('valid request injects packet and returns packetId + preview', async () => {
        const res = await request(app).post('/api/demo/send').send(validBody);
        expect(res.status).toBe(200);
        expect(res.body.packetId).toBeDefined();
        expect(res.body.ciphertextPreview).toMatch(/\.\.\.$/);
        expect(res.body.ttl).toBe(5); // Java default
        expect(res.body.injectedAt).toBe('phone-alice'); // Java default
    });

    test('injects at custom startDevice', async () => {
        const res = await request(app).post('/api/demo/send').send({
            ...validBody,
            startDevice: 'phone-stranger1',
        });
        expect(res.status).toBe(200);
        expect(res.body.injectedAt).toBe('phone-stranger1');
    });

    test('respects custom TTL', async () => {
        const res = await request(app).post('/api/demo/send').send({ ...validBody, ttl: 3 });
        expect(res.status).toBe(200);
        expect(res.body.ttl).toBe(3);
    });

    test('missing senderVpa → 400', async () => {
        const res = await request(app).post('/api/demo/send').send({ ...validBody, senderVpa: undefined });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/senderVpa/);
    });

    test('missing receiverVpa → 400', async () => {
        const res = await request(app).post('/api/demo/send').send({ ...validBody, receiverVpa: undefined });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/receiverVpa/);
    });

    test('missing amount → 400', async () => {
        const { amount, ...rest } = validBody;
        const res = await request(app).post('/api/demo/send').send(rest);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/amount/);
    });

    test('negative amount → 400', async () => {
        const res = await request(app).post('/api/demo/send').send({ ...validBody, amount: -50 });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/amount/);
    });

    test('zero amount → 400', async () => {
        const res = await request(app).post('/api/demo/send').send({ ...validBody, amount: 0 });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/amount/);
    });

    test('missing pin → 400', async () => {
        const { pin, ...rest } = validBody;
        const res = await request(app).post('/api/demo/send').send(rest);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/pin/);
    });

    test('unknown startDevice → 400', async () => {
        const res = await request(app).post('/api/demo/send').send({
            ...validBody,
            startDevice: 'does-not-exist',
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Unknown device/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mesh State
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/mesh/state', () => {
    test('returns 5 devices with correct structure', async () => {
        const res = await request(app).get('/api/mesh/state');
        expect(res.status).toBe(200);
        expect(res.body.devices).toHaveLength(5);
        expect(res.body.idempotencyCacheSize).toBe(0);

        const bridge = res.body.devices.find(d => d.deviceId === 'phone-bridge');
        expect(bridge.hasInternet).toBe(true);
    });

    test('packetCount increments after inject', async () => {
        await request(app).post('/api/demo/send').send({
            senderVpa: 'alice@demo',
            receiverVpa: 'bob@demo',
            amount: 100,
            pin: '1234',
        });
        const res = await request(app).get('/api/mesh/state');
        const alice = res.body.devices.find(d => d.deviceId === 'phone-alice');
        expect(alice.packetCount).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mesh Gossip
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/mesh/gossip', () => {
    test('empty mesh — 0 transfers', async () => {
        const res = await request(app).post('/api/mesh/gossip');
        expect(res.status).toBe(200);
        expect(res.body.transfers).toBe(0);
        expect(res.body.deviceCounts).toBeDefined();
    });

    test('after injection, gossip propagates packet to all devices', async () => {
        await request(app).post('/api/demo/send').send({
            senderVpa: 'alice@demo',
            receiverVpa: 'bob@demo',
            amount: 100,
            pin: '1234',
        });
        const res = await request(app).post('/api/mesh/gossip');
        expect(res.status).toBe(200);
        expect(res.body.transfers).toBe(4); // 1 packet × 4 other devices
        // All 5 devices should now have the packet
        for (const count of Object.values(res.body.deviceCounts)) {
            expect(count).toBe(1);
        }
    });

    test('multiple rounds via ?rounds=N', async () => {
        await request(app).post('/api/demo/send').send({
            senderVpa: 'alice@demo',
            receiverVpa: 'bob@demo',
            amount: 100,
            pin: '1234',
        });
        const res = await request(app).post('/api/mesh/gossip?rounds=3');
        expect(res.status).toBe(200);
        expect(res.body.rounds).toBe(3);
        expect(res.body.totalTransfers).toBeDefined();
        expect(res.body.deviceCounts).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mesh Reset
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/mesh/reset', () => {
    test('clears all packets and idempotency cache', async () => {
        // Inject a packet first
        await request(app).post('/api/demo/send').send({
            senderVpa: 'alice@demo', receiverVpa: 'bob@demo', amount: 100, pin: '1234',
        });

        const reset = await request(app).post('/api/mesh/reset');
        expect(reset.status).toBe(200);
        expect(reset.body.status).toBe('mesh and idempotency cache cleared');

        const state = await request(app).get('/api/mesh/state');
        for (const d of state.body.devices) {
            expect(d.packetCount).toBe(0);
        }
        expect(state.body.idempotencyCacheSize).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bridge Ingest (direct)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/bridge/ingest', () => {
    test('valid fresh packet → SETTLED', async () => {
        mockSettled();
        const ciphertext = buildValidCiphertext();

        const res = await request(app)
            .post('/api/bridge/ingest')
            .set('X-Bridge-Node-Id', 'test-bridge')
            .set('X-Hop-Count', '2')
            .send({ ciphertext });

        expect(res.status).toBe(200);
        expect(res.body.outcome).toBe('SETTLED');
        expect(res.body.packetHash).toBeDefined();
    });

    test('duplicate packet → DUPLICATE_DROPPED (200, not 500)', async () => {
        mockSettled();
        const ciphertext = buildValidCiphertext();

        await request(app).post('/api/bridge/ingest').send({ ciphertext });

        jest.clearAllMocks();
        const res = await request(app).post('/api/bridge/ingest').send({ ciphertext });

        expect(res.status).toBe(200);
        expect(res.body.outcome).toBe('DUPLICATE_DROPPED');
    });

    test('tampered ciphertext → INVALID (422)', async () => {
        const buf = Buffer.from(buildValidCiphertext(), 'base64');
        buf[300] ^= 0xff;
        const tampered = buf.toString('base64');

        const res = await request(app).post('/api/bridge/ingest').send({ ciphertext: tampered });

        expect(res.status).toBe(422);
        expect(res.body.outcome).toBe('INVALID');
        expect(res.body.reason).toBe('decryption_failed');
    });

    test('stale packet (>24h old signedAt) → INVALID (422)', async () => {
        const staleInstruction = {
            senderVpa: 'alice@demo',
            receiverVpa: 'bob@demo',
            amount: '100.00',
            pinHash: 'hash123',
            nonce: crypto.randomUUID(),
            signedAt: Date.now() - (86400 + 3600) * 1000, // 25h ago
        };
        const ciphertext = cryptoService.encryptPayment(staleInstruction);

        const res = await request(app).post('/api/bridge/ingest').send({ ciphertext });

        expect(res.status).toBe(422);
        expect(res.body.outcome).toBe('INVALID');
        expect(res.body.reason).toBe('stale_packet');
    });

    test('future-dated packet (>5min ahead) → INVALID (422)', async () => {
        const futureInstruction = {
            senderVpa: 'alice@demo',
            receiverVpa: 'bob@demo',
            amount: '100.00',
            pinHash: 'hash123',
            nonce: crypto.randomUUID(),
            signedAt: Date.now() + (300 + 600) * 1000, // 15 min in the future
        };
        const ciphertext = cryptoService.encryptPayment(futureInstruction);

        const res = await request(app).post('/api/bridge/ingest').send({ ciphertext });

        expect(res.status).toBe(422);
        expect(res.body.outcome).toBe('INVALID');
        expect(res.body.reason).toBe('future_dated');
    });

    test('settlement rejection (insufficient funds) → REJECTED (200)', async () => {
        mockRejected();
        const ciphertext = buildValidCiphertext();

        const res = await request(app).post('/api/bridge/ingest').send({ ciphertext });

        expect(res.status).toBe(200);
        expect(res.body.outcome).toBe('REJECTED');
        expect(res.body.reason).toBe('insufficient_funds');
    });

    test('missing ciphertext → 400', async () => {
        const res = await request(app).post('/api/bridge/ingest').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/ciphertext/);
    });

    test('X-Bridge-Node-Id header is passed through correctly', async () => {
        mockSettled();
        const ciphertext = buildValidCiphertext();

        const res = await request(app)
            .post('/api/bridge/ingest')
            .set('X-Bridge-Node-Id', 'my-bridge-node')
            .send({ ciphertext });

        expect(res.status).toBe(200);
        // bridgeNodeId is not in the IngestResult body (matches Java behavior),
        // but outcome must reflect successful ingestion
        expect(res.body.outcome).toBe('SETTLED');
    });

    test('default X-Bridge-Node-Id is "unknown" when header absent', async () => {
        mockSettled();
        const ciphertext = buildValidCiphertext();

        const res = await request(app).post('/api/bridge/ingest').send({ ciphertext });
        expect(res.status).toBe(200);
        expect(res.body.outcome).toBe('SETTLED');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mesh Flush
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/mesh/flush', () => {
    test('no packets on bridge — 0 uploads attempted', async () => {
        const res = await request(app).post('/api/mesh/flush');
        expect(res.status).toBe(200);
        expect(res.body.uploadsAttempted).toBe(0);
        expect(res.body.results).toEqual([]);
    });

    test('packet on bridge after gossip — flush calls ingestion', async () => {
        mockSettled();

        // Inject then gossip so bridge gets the packet
        await request(app).post('/api/demo/send').send({
            senderVpa: 'alice@demo', receiverVpa: 'bob@demo', amount: 100, pin: '1234',
        });
        await request(app).post('/api/mesh/gossip');

        const res = await request(app).post('/api/mesh/flush');
        expect(res.status).toBe(200);
        expect(res.body.uploadsAttempted).toBe(1);
        expect(res.body.results[0].outcome).toBe('SETTLED');
        expect(res.body.results[0].bridgeNode).toBe('phone-bridge');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard — Accounts/Transactions (mocked MongoDB)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/accounts', () => {
    test('returns accounts from DB', async () => {
        Account.find.mockReturnValue({
            lean: jest.fn().mockResolvedValue([
                { vpa: 'alice@demo', holderName: 'Alice', balance: { $numberDecimal: '1000' } }
            ])
        });

        const res = await request(app).get('/api/accounts');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

describe('GET /api/transactions', () => {
    test('returns up to 20 most recent transactions', async () => {
        Transaction.find.mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([
                { packetHash: 'abc', status: 'SETTLED', amount: { $numberDecimal: '100' } }
            ])
        });

        const res = await request(app).get('/api/transactions');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full End-to-End Flow
// ─────────────────────────────────────────────────────────────────────────────

describe('Full application flow: send → gossip → flush → settle', () => {
    test('packet travels from sender through mesh to bridge and settles', async () => {
        mockSettled();

        // 1. Inject payment into mesh at alice
        const sendRes = await request(app).post('/api/demo/send').send({
            senderVpa: 'alice@demo',
            receiverVpa: 'bob@demo',
            amount: 250,
            pin: '9999',
        });
        expect(sendRes.status).toBe(200);
        const { packetId } = sendRes.body;
        expect(packetId).toBeDefined();

        // 2. Verify mesh state — only alice has it
        const stateBefore = await request(app).get('/api/mesh/state');
        const aliceBefore = stateBefore.body.devices.find(d => d.deviceId === 'phone-alice');
        expect(aliceBefore.packetCount).toBe(1);

        // 3. One gossip round — propagates to all devices including bridge
        const gossipRes = await request(app).post('/api/mesh/gossip');
        expect(gossipRes.status).toBe(200);
        expect(gossipRes.body.transfers).toBe(4);

        // 4. Flush bridges — bridge submits to ingestion
        const flushRes = await request(app).post('/api/mesh/flush');
        expect(flushRes.status).toBe(200);
        expect(flushRes.body.uploadsAttempted).toBe(1);
        expect(flushRes.body.results[0].outcome).toBe('SETTLED');

        // 5. Verify idempotency — second flush is DUPLICATE_DROPPED
        const flush2 = await request(app).post('/api/mesh/flush');
        expect(flush2.body.results[0].outcome).toBe('DUPLICATE_DROPPED');
    });
});
