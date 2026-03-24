import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class WhatsappCryptoService {
  private readonly logger = new Logger(WhatsappCryptoService.name);

  decryptToken(ciphertext: string): string {
    const key = process.env.ENCRYPTION_KEY;
    if (!key || key.length < 32) {
      this.logger.warn('ENCRYPTION_KEY not set or too short — assuming token is base64 encoded (DEV ONLY)');
      return Buffer.from(ciphertext, 'base64').toString('utf8');
    }

    try {
      if (!ciphertext.includes(':')) {
         // Fallback para tokens en texto plano si llegaran a existir
         return ciphertext;
      }
      const [ivHex, tagHex, encryptedHex] = ciphertext.split(':');
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex').subarray(0, 32), Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (e) {
      this.logger.error(`Failed to decrypt WhatsApp token: ${e.message}`);
      throw new Error('Failure decrypting Meta credentials');
    }
  }
}
