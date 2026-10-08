const express = require('express');
const router = express.Router();
const cryptoService = require('../services/crypto.service');
const idempotencyService = require('../services/idempotency.service');
const { meshSimulatorService } = require('../services/mesh-simulator.service');
const { bridgeIngestionService } = require('../services/bridge-ingestion.service');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/server-key
// Mirrors: ApiController.getServerPublicKey()
// Returns the server's RSA public key so simulated sender phones can encrypt.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/server-key', (req, res) => {
    res.json({
        publicKey: cryptoService.getPublicKey(),
        algorithm: 'RSA-2048 / OAEP-SHA256',
        hybridScheme: 'RSA-OAEP encrypts an AES-256-GCM session key',
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/demo/send
// Mirrors: ApiController.demoSend()
//
// Simulates a sender phone creating an encrypted packet and injecting it
// into the mesh. Validates fields, builds the payment instruction, encrypts,
// wraps in a MeshPacket, and injects at the specified device.
//
// Required body: { senderVpa, receiverVpa, amount, pin }
// Optional body: { ttl (default 5), startDevice (default "phone-alice") }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/demo/send', (req, res, next) => {
    try {
        const { senderVpa, receiverVpa, amount, pin, ttl, startDevice } = req.body;

        // Validation — mirrors DemoSendRequest fields
        if (!senderVpa || typeof senderVpa !== 'string' || !senderVpa.trim()) {
            return res.status(400).json({ error: 'senderVpa is required' });
        }
        if (!receiverVpa || typeof receiverVpa !== 'string' || !receiverVpa.trim()) {
            return res.status(400).json({ error: 'receiverVpa is required' });
        }
        if (amount == null) {
            return res.status(400).json({ error: 'amount is required' });
        }
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'amount must be a positive number' });
        }
        if (!pin || typeof pin !== 'string') {
            return res.status(400).json({ error: 'pin is required' });
        }

        // Mirrors DemoService.createPacket() behavior:
        //   - nonce: UUID
        //   - signedAt: Instant.now().toEpochMilli()
        //   - pin is SHA-256 hashed before storing
        const pinHash = crypto.createHash('sha256').update(pin).digest('hex');
        const instruction = {
            senderVpa: senderVpa.trim(),
            receiverVpa: receiverVpa.trim(),
            amount: String(parsedAmount),
            pinHash,
            nonce: crypto.randomUUID(),
            signedAt: Date.now(),
        };

        const resolvedTtl = (ttl != null && Number.isInteger(Number(ttl)) && Number(ttl) >= 0)
            ? Number(ttl)
            : 5; // Java default: req.ttl == null ? 5 : req.ttl

        const { packet } = meshSimulatorService.createPacket(instruction, resolvedTtl);
        // Override the auto-generated instruction fields with our controlled ones
        // by re-encrypting with the exact instruction we built above
        const ciphertext = cryptoService.encryptPayment(instruction);
        packet.ciphertext = ciphertext;

        const targetDevice = startDevice || 'phone-alice'; // Java default
        meshSimulatorService.inject(targetDevice, packet);

        // Response mirrors Java exactly
        res.json({
            packetId: packet.packetId,
            ciphertextPreview: packet.ciphertext.substring(0, 64) + '...',
            ttl: packet.ttl,
            injectedAt: targetDevice,
        });
    } catch (err) {
        if (err.message && err.message.startsWith('Unknown device:')) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/mesh/state
// Mirrors: ApiController.meshState()
// Returns per-device packet counts and the idempotency cache size.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/mesh/state', (req, res) => {
    const devices = meshSimulatorService.getDevices().map(d => ({
        deviceId: d.deviceId,
        hasInternet: d.hasInternet,
        packetCount: d.packetCount(),
        packetIds: d.getHeldPackets().map(p => p.packetId.substring(0, 8)),
    }));

    res.json({
        devices,
        idempotencyCacheSize: idempotencyService.size(),
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mesh/gossip
// Mirrors: ApiController.meshGossip()
// Runs one gossip round (or N rounds if ?rounds=N is provided).
// The Java endpoint always runs exactly one round per call.
// We support an optional ?rounds query param for convenience.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/mesh/gossip', (req, res) => {
    const rounds = parseInt(req.query.rounds, 10);

    if (!isNaN(rounds) && rounds > 1) {
        const result = meshSimulatorService.gossipRounds(rounds);
        return res.json({
            rounds: result.rounds,
            totalTransfers: result.totalTransfers,
            deviceCounts: result.deviceCounts,
        });
    }

    // Default: single round — matches Java behavior exactly
    const result = meshSimulatorService.gossipOnce();
    res.json({
        transfers: result.transfers,
        deviceCounts: result.deviceCounts,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mesh/flush
// Mirrors: ApiController.meshFlush()
// All bridge nodes (hasInternet=true) upload their packets to bridge ingestion.
// hopCount formula: initialTtl - packet.ttl (Java line 123: 5 - up.packet().getTtl())
// ─────────────────────────────────────────────────────────────────────────────
router.post('/mesh/flush', async (req, res, next) => {
    try {
        const result = await meshSimulatorService.flushBridges(bridgeIngestionService);
        res.json(result);
    } catch (err) {
        next(err);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mesh/reset
// Mirrors: ApiController.meshReset()
// Clears all device-held packets AND clears the idempotency cache — both.
// Java does both in the same endpoint: mesh.resetMesh() + idempotency.clear()
// ─────────────────────────────────────────────────────────────────────────────
router.post('/mesh/reset', (req, res) => {
    meshSimulatorService.resetMesh();
    idempotencyService.clear();
    res.json({ status: 'mesh and idempotency cache cleared' });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bridge/ingest
// Mirrors: ApiController.ingest()
// THE production endpoint — a real bridge node POSTs an encrypted packet here.
//
// Headers (optional, with defaults matching Java):
//   X-Bridge-Node-Id: <string>  (default: "unknown")
//   X-Hop-Count: <int>          (default: 0)
//
// Body: { ciphertext: <base64 string> }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/bridge/ingest', async (req, res, next) => {
    try {
        const { ciphertext } = req.body || {};

        if (!ciphertext || typeof ciphertext !== 'string') {
            return res.status(400).json({ error: 'ciphertext is required' });
        }

        const bridgeNodeId = req.headers['x-bridge-node-id'] || 'unknown';
        const hopCount = parseInt(req.headers['x-hop-count'], 10) || 0;

        const result = await bridgeIngestionService.ingest(
            { ciphertext },
            bridgeNodeId,
            hopCount
        );

        // HTTP status mapping:
        //   SETTLED / REJECTED / DUPLICATE_DROPPED → 200 (business result, not error)
        //   INVALID → 422 (the packet itself was malformed/tampered/stale)
        const status = result.outcome === 'INVALID' ? 422 : 200;
        res.status(status).json(result);
    } catch (err) {
        next(err);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/accounts
// Mirrors: ApiController.listAccounts()
// Dashboard data — returns all accounts.
// Returns 503 if DB is unavailable.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/accounts', async (req, res, next) => {
    try {
        const accounts = await Account.find({}, { __v: 0 }).lean();
        res.json(accounts);
    } catch (err) {
        if (err.name === 'MongooseServerSelectionError' || err.name === 'MongoNetworkError' || err.name === 'MongooseError') {
            return res.status(503).json({ error: 'Database unavailable' });
        }
        next(err);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/transactions
// Mirrors: ApiController.listTransactions() — top 20 most recent
// ─────────────────────────────────────────────────────────────────────────────
router.get('/transactions', async (req, res, next) => {
    try {
        const transactions = await Transaction.find({}, { __v: 0 })
            .sort({ _id: -1 })
            .limit(20)
            .lean();
        res.json(transactions);
    } catch (err) {
        if (err.name === 'MongooseServerSelectionError' || err.name === 'MongoNetworkError' || err.name === 'MongooseError') {
            return res.status(503).json({ error: 'Database unavailable' });
        }
        next(err);
    }
});

module.exports = router;
