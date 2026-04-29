import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * AES-256-GCM token encryption for CRM OAuth tokens. Same pattern as
 * WhatsappCryptoService — different service so the dependency graph stays
 * tidy. ENCRYPTION_KEY is a 64-char hex (32 bytes after decode).
 */
@Injectable()
export class CrmCryptoService {
    private readonly logger = new Logger(CrmCryptoService.name);

    encrypt(plaintext: string): string {
        const key = process.env.ENCRYPTION_KEY;
        if (!key || key.length < 32) {
            this.logger.warn('ENCRYPTION_KEY missing — storing token as base64 (DEV ONLY)');
            return Buffer.from(plaintext).toString('base64');
        }
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex').subarray(0, 32), iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const tag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${tag}:${encrypted}`;
    }

    decrypt(ciphertext: string): string {
        const key = process.env.ENCRYPTION_KEY;
        if (!key || key.length < 32) {
            return Buffer.from(ciphertext, 'base64').toString('utf8');
        }
        if (!ciphertext.includes(':')) return ciphertext;
        const [ivHex, tagHex, encryptedHex] = ciphertext.split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex').subarray(0, 32), Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}
