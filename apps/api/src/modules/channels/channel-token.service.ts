import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as crypto from 'crypto';

export interface ChannelCredentials {
    accessToken: string;
    phoneNumberId: string;
    wabaId: string;
    channelId: string;
}

/**
 * Resolves access tokens for any channel, per tenant.
 * Lives in ChannelsModule to break the circular dependency
 * between ConversationsModule and WhatsappModule.
 */
@Injectable()
export class ChannelTokenService {
    private readonly logger = new Logger(ChannelTokenService.name);
    private readonly CACHE_TTL = 300; // 5 min

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    /**
     * Get valid access token for a tenant's WhatsApp channel.
     * Cached in Redis for 5 minutes.
     */
    async getWhatsAppToken(tenantId: string): Promise<ChannelCredentials> {
        const cacheKey = `wa_token:${tenantId}`;
        const cached = await this.redis.getJson<ChannelCredentials>(cacheKey);
        if (cached) return cached;

        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;

        // 1. Channel info from tenant schema
        const channels = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, phone_number_id, meta_waba_id, access_token_ref FROM whatsapp_channels LIMIT 1`,
        );
        if (!channels?.length) {
            throw new Error(`No WhatsApp channel for tenant ${tenantId}`);
        }
        const channel = channels[0];

        // 2. Encrypted credential from global table
        const cred = await this.prisma.whatsappCredential.findFirst({
            where: { tenantId, credentialType: 'system_user_token' },
            orderBy: { createdAt: 'desc' },
        });

        let accessToken: string;

        if (cred?.encryptedValue) {
            accessToken = this.decryptToken(cred.encryptedValue);
        } else if (channel.access_token_ref && channel.access_token_ref !== 'credential_ref') {
            accessToken = channel.access_token_ref;
        } else {
            throw new Error(`No WhatsApp credentials for tenant ${tenantId}`);
        }

        const result: ChannelCredentials = {
            accessToken,
            phoneNumberId: channel.phone_number_id,
            wabaId: channel.meta_waba_id,
            channelId: channel.id,
        };

        await this.redis.setJson(cacheKey, result, this.CACHE_TTL);
        return result;
    }

    /** AES-256-GCM decryption — same logic as WhatsappCryptoService */
    private decryptToken(ciphertext: string): string {
        const key = process.env.ENCRYPTION_KEY;
        if (!key || key.length < 32) {
            return Buffer.from(ciphertext, 'base64').toString('utf8');
        }
        if (!ciphertext.includes(':')) return ciphertext;

        const [ivHex, tagHex, encryptedHex] = ciphertext.split(':');
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            Buffer.from(key, 'hex').subarray(0, 32),
            Buffer.from(ivHex, 'hex'),
        );
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}
