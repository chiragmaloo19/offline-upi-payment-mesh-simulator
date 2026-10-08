const idempotencyService = require('../src/services/idempotency.service');

describe('Idempotency Service Tests', () => {

    // Clean up before each test to ensure isolated state
    beforeEach(() => {
        idempotencyService.clear();
    });

    test('1. First claim succeeds', () => {
        const hash = 'hash-abc12345';
        expect(idempotencyService.claim(hash)).toBe(true);
    });

    test('2. Second claim of the same hash is rejected as duplicate', () => {
        const hash = 'hash-abc12345';
        expect(idempotencyService.claim(hash)).toBe(true); // First claim
        expect(idempotencyService.claim(hash)).toBe(false); // Second claim
    });

    test('3. Different hashes can each be claimed', () => {
        const hash1 = 'hash-abc12345';
        const hash2 = 'hash-xyz67890';
        expect(idempotencyService.claim(hash1)).toBe(true);
        expect(idempotencyService.claim(hash2)).toBe(true);
    });

    test('4. has() correctly reports claimed/unclaimed hashes', () => {
        const hash = 'hash-abc12345';
        expect(idempotencyService.has(hash)).toBe(false);
        idempotencyService.claim(hash);
        expect(idempotencyService.has(hash)).toBe(true);
    });

    test('5. clear() resets state', () => {
        const hash = 'hash-abc12345';
        idempotencyService.claim(hash);
        expect(idempotencyService.has(hash)).toBe(true);
        
        idempotencyService.clear();
        
        expect(idempotencyService.has(hash)).toBe(false);
        // Can claim again after clear
        expect(idempotencyService.claim(hash)).toBe(true);
    });

    test('6. Multiple synchronous claim attempts for the same hash result in exactly one successful claim', () => {
        const hash = 'hash-race-condition';
        
        // Since Node.js JS execution is single-threaded, 
        // synchronous execution is inherently safe from race conditions, 
        // but we simulate parallel calls representing multiple synchronous claims.
        const results = Array.from({ length: 100 }, () => idempotencyService.claim(hash));
        
        const successes = results.filter(result => result === true);
        const failures = results.filter(result => result === false);
        
        expect(successes.length).toBe(1);
        expect(failures.length).toBe(99);
    });
    
    test('7. Expiration (TTL eviction)', () => {
        const hash = 'expired_hash';
        
        // Manipulate internal timestamp to simulate an entry older than 24h
        idempotencyService.seen.set(hash, Date.now() - (86500 * 1000));
        
        expect(idempotencyService.size()).toBe(1);
        idempotencyService.evictExpired();
        expect(idempotencyService.size()).toBe(0);
    });
    
    afterAll(() => {
        // Stop the setInterval timer so Jest can exit cleanly
        clearInterval(idempotencyService.interval);
    });
});
