class IdempotencyService {
    constructor(ttlSeconds = 86400) {
        this.seen = new Map();
        this.ttlSeconds = ttlSeconds;
        
        // Setup periodic cleanup (every 60 seconds)
        this.interval = setInterval(() => this.evictExpired(), 60000);
        
        // unref the timer so it doesn't keep the Node process running
        // if this is the only thing left in the event loop.
        if (this.interval.unref) {
            this.interval.unref();
        }
    }

    /**
     * Try to claim a hash.
     * Returns true if this caller is the first; false if already claimed (duplicate).
     * Because Node.js is single-threaded, a synchronous check-then-set is atomic.
     * There is no async boundary (e.g. `await`) during which context switching can occur.
     * 
     * @param {string} packetHash 
     * @returns {boolean} true if claimed successfully, false if duplicate
     */
    claim(packetHash) {
        if (this.seen.has(packetHash)) {
            return false;
        }
        this.seen.set(packetHash, Date.now());
        return true;
    }

    /**
     * Check if a hash has been claimed without claiming it.
     * 
     * @param {string} packetHash
     * @returns {boolean} true if already claimed
     */
    has(packetHash) {
        return this.seen.has(packetHash);
    }

    /**
     * Periodically evict entries past their TTL so memory doesn't grow unbounded.
     */
    evictExpired() {
        const cutoff = Date.now() - (this.ttlSeconds * 1000);
        for (const [hash, timestamp] of this.seen.entries()) {
            if (timestamp < cutoff) {
                this.seen.delete(hash);
            }
        }
    }

    /**
     * Get the number of claims in memory.
     */
    size() {
        return this.seen.size;
    }

    /**
     * Clear all claims (useful for tests/demos)
     */
    clear() {
        this.seen.clear();
    }
}

// Export a singleton instance matching the reference project's shared cache
module.exports = new IdempotencyService();
