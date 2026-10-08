const { randomUUID } = require('crypto');
const cryptoService = require('./crypto.service');

/**
 * Simulates the offline Bluetooth mesh network.
 *
 * Faithfully mirrors MeshSimulatorService.java and VirtualDevice.java.
 *
 * Architecture:
 *   - VirtualDevice: a simulated phone. Holds packets keyed by packetId
 *     (Map<packetId, MeshPacket>). Keying by packetId prevents the same
 *     packet being stored twice on a single device — directly mirrors
 *     VirtualDevice.java's ConcurrentHashMap + putIfAbsent.
 *
 *   - MeshSimulatorService: orchestrates devices, gossip rounds, and bridge flushing.
 *
 * Default scenario (from Java seedDefaultDevices()):
 *   4 offline phones + 1 phone-bridge (hasInternet=true)
 *
 * Gossip algorithm (from gossipOnce() in Java):
 *   1. Snapshot all devices' held packets at the START of the round.
 *   2. For each source device, for each packet in its snapshot:
 *      a. Skip if TTL <= 0 (cannot forward).
 *      b. For each destination device (excluding self):
 *         - Skip if destination already holds this packetId.
 *         - Create a COPY of the packet with TTL decremented by 1.
 *         - Give the copy to the destination device.
 *   The snapshot prevents a packet from cascading through all devices in one step.
 *
 * Hop count formula (from ApiController.java line 123):
 *   hopCount = initialTtl - packet.ttl
 *   where initialTtl defaults to 5 (DemoService.java: ttl = req.ttl == null ? 5 : req.ttl)
 *
 * Bridge flushing (from collectBridgeUploads() + meshFlush() in Java):
 *   - Collect all packets held by devices with hasInternet===true.
 *   - Each packet is submitted to the BridgeIngestionService.
 *   - The bridgeNodeId is the device's deviceId.
 *   - hopCount = initialTtl - packet.ttl  (ApiController line 123: 5 - up.packet().getTtl())
 *   - Packets are NOT removed from the device after flushing (Java does not remove them either —
 *     the bridge device just keeps holding them, idempotency prevents re-settlement).
 */

const DEFAULT_TTL = 5;

// ─────────────────────────────────────────────────────────────────────────────
// VirtualDevice — mirrors VirtualDevice.java exactly
// ─────────────────────────────────────────────────────────────────────────────

class VirtualDevice {
    /**
     * @param {string}  deviceId
     * @param {boolean} hasInternet
     */
    constructor(deviceId, hasInternet) {
        this.deviceId = deviceId;
        this.hasInternet = hasInternet;
        // Map<packetId, MeshPacket> — mirrors ConcurrentHashMap in Java
        // putIfAbsent semantics enforced in hold()
        this._heldPackets = new Map();
    }

    /**
     * Accept a packet onto this device.
     * Mirrors: heldPackets.putIfAbsent(packet.getPacketId(), packet)
     * Will silently ignore if this packetId is already held.
     * @param {MeshPacket} packet
     */
    hold(packet) {
        if (!this._heldPackets.has(packet.packetId)) {
            this._heldPackets.set(packet.packetId, packet);
        }
    }

    /**
     * @returns {MeshPacket[]}
     */
    getHeldPackets() {
        return Array.from(this._heldPackets.values());
    }

    /**
     * @param {string} packetId
     * @returns {boolean}
     */
    holds(packetId) {
        return this._heldPackets.has(packetId);
    }

    packetCount() {
        return this._heldPackets.size;
    }

    clear() {
        this._heldPackets.clear();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MeshSimulatorService — mirrors MeshSimulatorService.java exactly
// ─────────────────────────────────────────────────────────────────────────────

class MeshSimulatorService {
    constructor() {
        // Map<deviceId, VirtualDevice> — mirrors ConcurrentHashMap in Java
        this.devices = new Map();
        // Seed the default scenario from Java seedDefaultDevices()
        this._seedDefaultDevices();
    }

    // ── Seeding ──────────────────────────────────────────────────────────────

    _seedDefaultDevices() {
        this._addDevice('phone-alice',    false);
        this._addDevice('phone-stranger1', false);
        this._addDevice('phone-stranger2', false);
        this._addDevice('phone-stranger3', false);
        this._addDevice('phone-bridge',   true);
    }

    _addDevice(deviceId, hasInternet) {
        this.devices.set(deviceId, new VirtualDevice(deviceId, hasInternet));
    }

    // ── Public device access ──────────────────────────────────────────────────

    /**
     * @returns {VirtualDevice[]}
     */
    getDevices() {
        return Array.from(this.devices.values());
    }

    /**
     * @param {string} id
     * @returns {VirtualDevice|undefined}
     */
    getDevice(id) {
        return this.devices.get(id);
    }

    // ── Packet injection ─────────────────────────────────────────────────────

    /**
     * Sender drops a packet into the mesh by handing it to their own device.
     * Mirrors: inject(String senderDeviceId, MeshPacket packet)
     *
     * @param {string} senderDeviceId
     * @param {MeshPacket} packet
     */
    inject(senderDeviceId, packet) {
        const sender = this.devices.get(senderDeviceId);
        if (!sender) throw new Error(`Unknown device: ${senderDeviceId}`);
        sender.hold(packet);
    }

    /**
     * Build a MeshPacket from a plaintext payment instruction.
     * Mirrors DemoService.createPacket() — encrypts and wraps in MeshPacket.
     *
     * @param {Object}  instruction  { senderVpa, receiverVpa, amount, pinHash, nonce?, signedAt? }
     * @param {number}  ttl          defaults to DEFAULT_TTL (5)
     * @returns {{ packet: MeshPacket, ciphertext: string }}
     */
    createPacket(instruction, ttl = DEFAULT_TTL) {
        const fullInstruction = {
            nonce: randomUUID(),
            signedAt: Date.now(),
            ...instruction,
        };
        const ciphertext = cryptoService.encryptPayment(fullInstruction);
        const packet = {
            packetId: randomUUID(),
            ttl,
            createdAt: Date.now(),
            ciphertext,
        };
        return { packet, instruction: fullInstruction };
    }

    // ── Gossip ───────────────────────────────────────────────────────────────

    /**
     * One round of gossip — mirrors gossipOnce() in Java exactly.
     *
     * Key design decisions from the Java source:
     *   - Snapshot is taken BEFORE iteration so a packet can only move one
     *     hop per round (prevents "teleporting" through all devices in 1 step).
     *   - TTL is decremented on the COPY that is given to the destination
     *     (the source still holds its original TTL value).
     *   - Packets with TTL <= 0 are NOT forwarded (they stay put on the device
     *     that holds them but cannot propagate further).
     *   - dst.hold() uses putIfAbsent semantics — each device stores a packet
     *     at most once.
     *
     * @returns {{ transfers: number, deviceCounts: Object.<string, number> }}
     */
    gossipOnce() {
        let transfers = 0;
        const deviceList = Array.from(this.devices.values());

        // Snapshot what each device holds at the START of this round
        const snapshot = new Map();
        for (const d of deviceList) {
            snapshot.set(d.deviceId, [...d.getHeldPackets()]);
        }

        for (const src of deviceList) {
            for (const pkt of snapshot.get(src.deviceId)) {
                // Skip if TTL is exhausted — cannot forward
                if (pkt.ttl <= 0) continue;

                for (const dst of deviceList) {
                    if (dst === src) continue;
                    if (dst.holds(pkt.packetId)) continue;

                    // Create a copy with decremented TTL — mirrors Java exactly
                    const copy = {
                        packetId: pkt.packetId,
                        ttl: pkt.ttl - 1,
                        createdAt: pkt.createdAt,
                        ciphertext: pkt.ciphertext,
                    };
                    dst.hold(copy);
                    transfers++;
                }
            }
        }

        return { transfers, deviceCounts: this.snapshotMap() };
    }

    /**
     * Run N gossip rounds sequentially.
     * @param {number} rounds
     * @returns {{ rounds: number, totalTransfers: number, deviceCounts: Object }}
     */
    gossipRounds(rounds) {
        let totalTransfers = 0;
        let lastCounts = {};
        for (let i = 0; i < rounds; i++) {
            const r = this.gossipOnce();
            totalTransfers += r.transfers;
            lastCounts = r.deviceCounts;
        }
        return { rounds, totalTransfers, deviceCounts: lastCounts };
    }

    /**
     * @returns {Object.<string, number>}  deviceId → packetCount
     */
    snapshotMap() {
        const m = {};
        for (const d of this.devices.values()) {
            m[d.deviceId] = d.packetCount();
        }
        return m;
    }

    // ── Bridge flushing ───────────────────────────────────────────────────────

    /**
     * Collect all packets held by bridge devices (hasInternet===true).
     * Mirrors collectBridgeUploads() in MeshSimulatorService.java.
     *
     * @returns {{ bridgeNodeId: string, packet: MeshPacket }[]}
     */
    collectBridgeUploads() {
        const out = [];
        for (const d of this.devices.values()) {
            if (!d.hasInternet) continue;
            for (const pkt of d.getHeldPackets()) {
                out.push({ bridgeNodeId: d.deviceId, packet: pkt });
            }
        }
        return out;
    }

    /**
     * Flush all bridge devices by submitting their packets to the
     * BridgeIngestionService — mirrors meshFlush() in ApiController.java.
     *
     * Hop count formula (directly from ApiController.java line 123):
     *   hopCount = initialTtl - packet.ttl
     * where initialTtl is DEFAULT_TTL (5).
     *
     * Packets are NOT removed from the bridge device after flushing —
     * the Java reference does not remove them either. The idempotency
     * layer prevents re-settlement on subsequent flushes.
     *
     * @param {Object} bridgeIngestionService  the BridgeIngestionService instance
     * @param {number} initialTtl              TTL used when packet was first created (default 5)
     * @returns {Promise<{ uploadsAttempted: number, results: Object[] }>}
     */
    async flushBridges(bridgeIngestionService, initialTtl = DEFAULT_TTL) {
        const uploads = this.collectBridgeUploads();
        const results = [];

        // Process sequentially (Java uses parallelStream, but Node is single-threaded;
        // order does not matter for correctness since idempotency handles any interleaving)
        for (const up of uploads) {
            const hopCount = initialTtl - up.packet.ttl;
            const result = await bridgeIngestionService.ingest(
                { ciphertext: up.packet.ciphertext },
                up.bridgeNodeId,
                hopCount
            );
            results.push({
                bridgeNode: up.bridgeNodeId,
                packetId: up.packet.packetId.substring(0, 8),
                outcome: result.outcome,
                reason: result.reason || '',
                transactionId: result.transactionId || null,
            });
        }

        return { uploadsAttempted: uploads.length, results };
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    /**
     * Clear all packets from all devices. Mirrors resetMesh() in Java.
     * (Does NOT clear the idempotency cache — the caller does that separately,
     *  mirroring the Java /api/mesh/reset endpoint which clears both independently.)
     */
    resetMesh() {
        for (const d of this.devices.values()) {
            d.clear();
        }
    }
}

module.exports = {
    MeshSimulatorService,
    VirtualDevice,
    DEFAULT_TTL,
    // Export a singleton, matching the @Service Spring singleton pattern
    meshSimulatorService: new MeshSimulatorService(),
};
