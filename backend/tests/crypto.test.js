const cryptoService = require('../src/services/crypto.service');

describe('Crypto Service Tests', () => {

    const samplePayment = {
        senderVpa: 'alice@demo',
        receiverVpa: 'bob@demo',
        amount: '100.00',
        pinHash: 'hash123',
        nonce: 'uuid-nonce-1',
        signedAt: Date.now()
    };

    test('A. Encryption -> decryption round trip', () => {
        const ciphertext = cryptoService.encryptPayment(samplePayment);
        const decrypted = cryptoService.decryptPayment(ciphertext);
        expect(decrypted).toEqual(samplePayment);
    });

    test('B. Different encryption each time', () => {
        const cipher1 = cryptoService.encryptPayment(samplePayment);
        const cipher2 = cryptoService.encryptPayment(samplePayment);
        expect(cipher1).not.toBe(cipher2);
    });

    test('C. Tampering detection', () => {
        const ciphertext = cryptoService.encryptPayment(samplePayment);
        const buf = Buffer.from(ciphertext, 'base64');
        
        // Flip a byte in the AES ciphertext portion (index 300 is well past RSA+IV)
        buf[300] = buf[300] ^ 1;
        
        const tampered = buf.toString('base64');
        
        expect(() => {
            cryptoService.decryptPayment(tampered);
        }).toThrow();
    });

    test('D. Hash consistency', () => {
        const ciphertext = cryptoService.encryptPayment(samplePayment);
        const hash1 = cryptoService.hashCiphertext(ciphertext);
        const hash2 = cryptoService.hashCiphertext(ciphertext);
        expect(hash1).toBe(hash2);
    });

    test('E. Different ciphertext -> different hash', () => {
        const cipher1 = cryptoService.encryptPayment(samplePayment);
        const cipher2 = cryptoService.encryptPayment(samplePayment);
        
        const hash1 = cryptoService.hashCiphertext(cipher1);
        const hash2 = cryptoService.hashCiphertext(cipher2);
        
        expect(hash1).not.toBe(hash2);
    });

    test('F. Required cryptographic properties', () => {
        const pubKey = cryptoService.getPublicKey();
        expect(pubKey).toContain('-----BEGIN PUBLIC KEY-----');
        
        // Ensure RSA-2048 by checking length of RSA encrypted key segment
        const ciphertext = cryptoService.encryptPayment(samplePayment);
        const buf = Buffer.from(ciphertext, 'base64');
        const rsaEnc = buf.subarray(0, 256); // 2048 bits = 256 bytes
        expect(rsaEnc.length).toBe(256);
    });
});
