/**
 * Mesh Simulator Tests
 *
 * Tests the MeshSimulatorService behavior against the Java reference.
 *
 * Strategy:
 *   - Real crypto.service used for packet creation (verifies real encryption flows through)
 *   - BridgeIngestionService is MOCKED — these are unit tests for the mesh layer only
 *   - Each test instantiates a FRESH MeshSimulatorService (not the singleton) to avoid state leakage
 */

const { MeshSimulatorService, VirtualDevice, DEFAULT_TTL } = require('../src/services/mesh-simulator.service');
const cryptoService = require('../src/services/crypto.service');
const { randomUUID } = require('crypto');

// Mock the bridge ingestion service
jest.mock('../src/services/bridge-ingestion.service', () => ({
    bridgeIngestionService: {
        ingest: jest.fn()
    },
    IngestResult: jest.requireActual('../src/services/bridge-ingestion.service').IngestResult,
    MAX_AGE_SECONDS: 86400,
    MAX_FUTURE_SECONDS: 300,
}));
const { bridgeIngestionService } = require('../src/services/bridge-ingestion.service');

// Helper: build a minimal MeshPacket (like DemoService.createPacket)
function buildPacket(overrides = {}) {
    const ciphertext = cryptoService.encryptPayment({
        senderVpa: 'alice@demo',
        receiverVpa: 'bob@demo',
        amount: '100.00',
        pinHash: 'hash123',
        nonce: randomUUID(),
        signedAt: Date.now(),
    });
    return {
        packetId: randomUUID(),
        ttl: DEFAULT_TTL,
        createdAt: Date.now(),
        ciphertext,
        ...overrides,
    };
}

// Each test gets a fresh simulator instance
function freshSim() {
    return new MeshSimulatorService();
}

describe('Mesh Simulator — Device Creation', () => {
    test('default scenario has 5 devices', () => {
        const sim = freshSim();
        expect(sim.getDevices().length).toBe(5);
    });

    test('phone-bridge has internet; others do not', () => {
        const sim = freshSim();
        const bridge = sim.getDevice('phone-bridge');
        expect(bridge).toBeDefined();
        expect(bridge.hasInternet).toBe(true);

        const offline = ['phone-alice', 'phone-stranger1', 'phone-stranger2', 'phone-stranger3'];
        for (const id of offline) {
            expect(sim.getDevice(id).hasInternet).toBe(false);
        }
    });

    test('all devices start with zero packets', () => {
        const sim = freshSim();
        for (const d of sim.getDevices()) {
            expect(d.packetCount()).toBe(0);
        }
    });
});

describe('Mesh Simulator — Packet Injection', () => {
    test('inject places packet on the correct device', () => {
        const sim = freshSim();
        const pkt = buildPacket();
        sim.inject('phone-alice', pkt);

        const alice = sim.getDevice('phone-alice');
        expect(alice.packetCount()).toBe(1);
        expect(alice.holds(pkt.packetId)).toBe(true);
    });

    test('ciphertext is preserved unchanged after injection', () => {
        const sim = freshSim();
        const pkt = buildPacket();
        sim.inject('phone-alice', pkt);

        const held = sim.getDevice('phone-alice').getHeldPackets()[0];
        expect(held.ciphertext).toBe(pkt.ciphertext);
    });

    test('inject into unknown device throws', () => {
        const sim = freshSim();
        expect(() => sim.inject('ghost-phone', buildPacket())).toThrow('Unknown device: ghost-phone');
    });

    test('injecting the same packetId twice does not duplicate it (putIfAbsent)', () => {
        const sim = freshSim();
        const pkt = buildPacket();
        sim.inject('phone-alice', pkt);
        sim.inject('phone-alice', pkt); // second injection of same packet
        expect(sim.getDevice('phone-alice').packetCount()).toBe(1);
    });
});

describe('Mesh Simulator — Gossip Algorithm', () => {
    test('one gossip round propagates packet from one device to all others', () => {
        const sim = freshSim();
        const pkt = buildPacket({ ttl: DEFAULT_TTL }); // TTL=5
        sim.inject('phone-alice', pkt);

        const result = sim.gossipOnce();

        // Alice has 1, strangers + bridge should now also have it
        // 4 other devices × 1 packet each = 4 transfers
        expect(result.transfers).toBe(4);
        for (const d of sim.getDevices()) {
            expect(d.holds(pkt.packetId)).toBe(true);
        }
    });

    test('TTL is decremented on the copy, not the original', () => {
        const sim = freshSim();
        const pkt = buildPacket({ ttl: 3 });
        sim.inject('phone-alice', pkt);

        sim.gossipOnce();

        // The copy received by other devices should have TTL = 2
        const stranger1 = sim.getDevice('phone-stranger1');
        const received = stranger1.getHeldPackets()[0];
        expect(received.ttl).toBe(2);

        // Alice's original should still have TTL = 3
        const alicePkt = sim.getDevice('phone-alice').getHeldPackets()[0];
        expect(alicePkt.ttl).toBe(3);
    });

    test('packet with TTL=0 is NOT forwarded further', () => {
        const sim = freshSim();
        const pkt = buildPacket({ ttl: 0 });
        sim.inject('phone-alice', pkt);

        const result = sim.gossipOnce();

        expect(result.transfers).toBe(0);
        // Only alice holds it
        for (const d of sim.getDevices()) {
            if (d.deviceId !== 'phone-alice') {
                expect(d.holds(pkt.packetId)).toBe(false);
            }
        }
    });

    test('packet with TTL=1 propagates one more hop then stops', () => {
        const sim = freshSim();
        const pkt = buildPacket({ ttl: 1 });
        sim.inject('phone-alice', pkt);

        // Round 1: alice → all others with TTL=0
        const r1 = sim.gossipOnce();
        expect(r1.transfers).toBe(4);

        // Round 2: all hold it with TTL=0; no more forwarding
        const r2 = sim.gossipOnce();
        expect(r2.transfers).toBe(0);
    });

    test('same packetId is NOT stored twice on any device', () => {
        const sim = freshSim();
        const pkt = buildPacket({ ttl: 5 });
        sim.inject('phone-alice', pkt);

        // Run multiple rounds
        sim.gossipOnce();
        sim.gossipOnce();
        sim.gossipOnce();

        for (const d of sim.getDevices()) {
            expect(d.packetCount()).toBe(1);
        }
    });

    test('snapshot prevents a packet from traveling more than one hop per round', () => {
        // Build a chain: only phone-alice starts with the packet.
        // After round 1, all devices have it (TTL-1).
        // If snapshots were NOT used, you could get multiple hops per round.
        const sim = freshSim();
        const pkt = buildPacket({ ttl: 5 });
        sim.inject('phone-alice', pkt);

        const r = sim.gossipOnce();

        // Every non-alice device should have exactly TTL=4 (one hop less)
        for (const d of sim.getDevices()) {
            if (d.deviceId !== 'phone-alice') {
                const held = d.getHeldPackets()[0];
                expect(held.ttl).toBe(4); // exactly 1 hop decremented
            }
        }
    });

    test('multiple gossip rounds work (gossipRounds)', () => {
        const sim = freshSim();
        const pkt = buildPacket({ ttl: 5 });
        sim.inject('phone-alice', pkt);

        const result = sim.gossipRounds(2);
        expect(result.rounds).toBe(2);
        // All 5 devices should hold it after 2 rounds
        for (const d of sim.getDevices()) {
            expect(d.holds(pkt.packetId)).toBe(true);
        }
    });

    test('multiple distinct packets propagate independently', () => {
        const sim = freshSim();
        const pkt1 = buildPacket({ ttl: 5 });
        const pkt2 = buildPacket({ ttl: 5 });
        sim.inject('phone-alice', pkt1);
        sim.inject('phone-stranger1', pkt2);

        sim.gossipOnce();

        for (const d of sim.getDevices()) {
            expect(d.holds(pkt1.packetId)).toBe(true);
            expect(d.holds(pkt2.packetId)).toBe(true);
        }
    });

    test('empty mesh — gossip returns 0 transfers', () => {
        const sim = freshSim();
        const result = sim.gossipOnce();
        expect(result.transfers).toBe(0);
    });
});

describe('Mesh Simulator — Bridge Flushing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('collectBridgeUploads returns packets from bridge device only', () => {
        const sim = freshSim();
        const pkt = buildPacket({ ttl: 2 });
        sim.inject('phone-bridge', pkt);

        const uploads = sim.collectBridgeUploads();
        expect(uploads.length).toBe(1);
        expect(uploads[0].bridgeNodeId).toBe('phone-bridge');
        expect(uploads[0].packet.packetId).toBe(pkt.packetId);
    });

    test('offline devices are NOT included in bridge uploads', () => {
        const sim = freshSim();
        sim.inject('phone-alice', buildPacket());

        const uploads = sim.collectBridgeUploads();
        expect(uploads.length).toBe(0);
    });

    test('flushBridges calls ingestion with correct bridgeNodeId', async () => {
        const sim = freshSim();
        const pkt = buildPacket({ ttl: 3 });
        sim.inject('phone-bridge', pkt);

        bridgeIngestionService.ingest.mockResolvedValue({ outcome: 'SETTLED', transactionId: 'tx1', reason: null });

        await sim.flushBridges(bridgeIngestionService);

        expect(bridgeIngestionService.ingest).toHaveBeenCalledTimes(1);
        const [calledPacket, calledBridge] = bridgeIngestionService.ingest.mock.calls[0];
        expect(calledBridge).toBe('phone-bridge');
        expect(calledPacket.ciphertext).toBe(pkt.ciphertext);
    });

    test('flushBridges passes correct hop count: initialTtl - packet.ttl', async () => {
        // initialTtl=5, packet.ttl=3 → hopCount should be 5-3=2
        const sim = freshSim();
        const pkt = buildPacket({ ttl: 3 }); // arrived at bridge with TTL=3
        sim.inject('phone-bridge', pkt);

        bridgeIngestionService.ingest.mockResolvedValue({ outcome: 'SETTLED', transactionId: 'tx1', reason: null });

        await sim.flushBridges(bridgeIngestionService, 5); // initialTtl=5

        const [, , calledHopCount] = bridgeIngestionService.ingest.mock.calls[0];
        expect(calledHopCount).toBe(2); // 5 - 3 = 2
    });

    test('flushBridges result maps ingestion outcomes correctly', async () => {
        const sim = freshSim();
        sim.inject('phone-bridge', buildPacket({ ttl: 2 }));

        bridgeIngestionService.ingest.mockResolvedValue({ outcome: 'DUPLICATE_DROPPED', transactionId: null, reason: null });

        const { results } = await sim.flushBridges(bridgeIngestionService);
        expect(results[0].outcome).toBe('DUPLICATE_DROPPED');
    });

    test('packets are NOT removed from bridge after flushing (Java behavior — idempotency prevents re-settlement)', async () => {
        const sim = freshSim();
        const pkt = buildPacket({ ttl: 2 });
        sim.inject('phone-bridge', pkt);

        bridgeIngestionService.ingest.mockResolvedValue({ outcome: 'SETTLED', transactionId: 'tx1', reason: null });

        await sim.flushBridges(bridgeIngestionService);

        // Bridge still holds the packet
        expect(sim.getDevice('phone-bridge').holds(pkt.packetId)).toBe(true);
    });

    test('no bridge device — flushBridges returns 0 uploads', async () => {
        // Build a sim with no internet devices
        const sim = new MeshSimulatorService();
        // Manually replace all with offline devices
        sim.devices.clear();
        sim.devices.set('phone-a', new VirtualDevice('phone-a', false));
        sim.inject('phone-a', buildPacket());

        const { uploadsAttempted } = await sim.flushBridges(bridgeIngestionService);
        expect(uploadsAttempted).toBe(0);
        expect(bridgeIngestionService.ingest).not.toHaveBeenCalled();
    });

    test('no packets — flushBridges returns 0 uploads', async () => {
        const sim = freshSim();
        const { uploadsAttempted } = await sim.flushBridges(bridgeIngestionService);
        expect(uploadsAttempted).toBe(0);
    });
});

describe('Mesh Simulator — Full End-to-End Scenario', () => {
    test('inject → gossip → bridge flush pipeline', async () => {
        const sim = freshSim();
        const pkt = buildPacket({ ttl: DEFAULT_TTL });
        sim.inject('phone-alice', pkt);

        // Gossip until bridge gets it (1 round is enough for all-to-all)
        sim.gossipOnce();
        expect(sim.getDevice('phone-bridge').holds(pkt.packetId)).toBe(true);

        bridgeIngestionService.ingest.mockResolvedValue({ outcome: 'SETTLED', transactionId: 'mock-tx', reason: null });

        const { uploadsAttempted, results } = await sim.flushBridges(bridgeIngestionService);
        expect(uploadsAttempted).toBe(1);
        expect(results[0].outcome).toBe('SETTLED');
    });
});

describe('Mesh Simulator — Reset', () => {
    test('resetMesh clears all device packets', () => {
        const sim = freshSim();
        sim.inject('phone-alice', buildPacket());
        sim.inject('phone-bridge', buildPacket());
        sim.gossipOnce();

        sim.resetMesh();

        for (const d of sim.getDevices()) {
            expect(d.packetCount()).toBe(0);
        }
    });
});

describe('Mesh Simulator — VirtualDevice unit', () => {
    test('VirtualDevice.hold is idempotent (putIfAbsent)', () => {
        const d = new VirtualDevice('test-dev', false);
        const pkt = buildPacket();
        d.hold(pkt);
        d.hold(pkt);
        expect(d.packetCount()).toBe(1);
    });

    test('VirtualDevice.holds returns correct boolean', () => {
        const d = new VirtualDevice('test-dev', false);
        const pkt = buildPacket();
        expect(d.holds(pkt.packetId)).toBe(false);
        d.hold(pkt);
        expect(d.holds(pkt.packetId)).toBe(true);
    });

    test('VirtualDevice.clear empties held packets', () => {
        const d = new VirtualDevice('test-dev', false);
        d.hold(buildPacket());
        d.hold(buildPacket());
        d.clear();
        expect(d.packetCount()).toBe(0);
    });
});
