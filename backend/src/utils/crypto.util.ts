import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

let encryptionKey: Buffer | null = null;
let warnedOnce = false;

const getEncryptionKey = (): Buffer => {
    if (encryptionKey) return encryptionKey;

    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex || keyHex.length !== 64) {
        // Use a default key for development - in production, set ENCRYPTION_KEY in .env
        if (!warnedOnce) {
            warnedOnce = true;
        }
        encryptionKey = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
    } else {
        encryptionKey = Buffer.from(keyHex, 'hex');
    }
    return encryptionKey;
};

/**
 * Encrypts a password using AES-256-GCM
 * @param password - Plain text password to encrypt
 * @returns Encrypted string in format: iv:authTag:encryptedData
 */
export const encryptPassword = (password: string): string => {
    if (!password) return '';

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Return format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
};

/**
 * Decrypts a password encrypted with encryptPassword()
 * @param encryptedStr - Encrypted string in format: iv:authTag:encryptedData
 * @returns Decrypted plain text password
 */
export const decryptPassword = (encryptedStr: string): string => {
    if (!encryptedStr) return '';

    // Handle legacy base64-encoded passwords (for backwards compatibility)
    if (!encryptedStr.includes(':')) {
        try {
            return Buffer.from(encryptedStr, 'base64').toString('utf8');
        } catch {
            return encryptedStr;
        }
    }

    const key = getEncryptionKey();
    const parts = encryptedStr.split(':');

    if (parts.length !== 3) {
        // Not a valid encrypted string, return as-is
        return encryptedStr;
    }

    try {
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedText = parts[2];

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        return '';
    }
};

/**
 * Generates a new encryption key
 * Use this to generate a key for .env file
 * @returns 64-character hex string (32 bytes)
 */
export const generateEncryptionKey = (): string => {
    return crypto.randomBytes(32).toString('hex');
};
