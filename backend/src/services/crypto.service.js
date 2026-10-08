const crypto = require('crypto');

class CryptoService {
    constructor() {
        this.privateKey = null;
        this.publicKey = null;
        // Generate on startup as per instructions for local demo
        this.generateKeyPair();
    }

    generateKeyPair() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        this.publicKey = publicKey;
        this.privateKey = privateKey;
    }

    getPublicKey() {
        return this.publicKey;
    }

    /**
     * Encrypt a payment instruction object
     */
    encryptPayment(paymentInstruction, pubKey = this.publicKey) {
        const plaintext = Buffer.from(JSON.stringify(paymentInstruction), 'utf8');

        // 1. Generate one-time AES-256 key
        const aesKey = crypto.randomBytes(32);

        // 2. AES-256-GCM encrypt
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
        
        let ciphertext = cipher.update(plaintext);
        ciphertext = Buffer.concat([ciphertext, cipher.final()]);
        const authTag = cipher.getAuthTag(); // 16 bytes

        // 3. RSA-OAEP encrypt AES key
        const rsaEncryptedAesKey = crypto.publicEncrypt({
            key: pubKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256'
        }, aesKey);

        // 4. Pack: [256 bytes RSA][12 bytes IV][ciphertext][16 bytes Tag]
        const packed = Buffer.concat([
            rsaEncryptedAesKey,
            iv,
            ciphertext,
            authTag
        ]);

        return packed.toString('base64');
    }

    /**
     * Decrypt using server private key
     */
    decryptPayment(base64Ciphertext) {
        const buf = Buffer.from(base64Ciphertext, 'base64');

        const RSA_LEN = 256;
        const IV_LEN = 12;
        const TAG_LEN = 16;

        if (buf.length < RSA_LEN + IV_LEN + TAG_LEN) {
            throw new Error('Ciphertext too short');
        }

        // Unpack
        const rsaEncryptedAesKey = buf.subarray(0, RSA_LEN);
        const iv = buf.subarray(RSA_LEN, RSA_LEN + IV_LEN);
        const ciphertext = buf.subarray(RSA_LEN + IV_LEN, buf.length - TAG_LEN);
        const authTag = buf.subarray(buf.length - TAG_LEN);

        // 1. RSA-decrypt AES key
        let aesKey;
        try {
            aesKey = crypto.privateDecrypt({
                key: this.privateKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'
            }, rsaEncryptedAesKey);
        } catch (err) {
            throw new Error('Failed to decrypt AES key: ' + err.message);
        }

        // 2. AES-GCM decrypt & verify tag
        let plaintext;
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
            decipher.setAuthTag(authTag);
            plaintext = decipher.update(ciphertext);
            plaintext = Buffer.concat([plaintext, decipher.final()]);
        } catch (err) {
            throw new Error('Failed to decrypt payload (tampering detected or invalid key): ' + err.message);
        }

        return JSON.parse(plaintext.toString('utf8'));
    }

    /**
     * SHA-256 hash of the base64 ciphertext for idempotency
     */
    hashCiphertext(base64Ciphertext) {
        return crypto.createHash('sha256')
                     .update(base64Ciphertext, 'utf8')
                     .digest('hex');
    }
}

// Export a singleton instance
module.exports = new CryptoService();
