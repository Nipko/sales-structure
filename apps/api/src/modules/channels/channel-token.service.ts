import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import * as crypto from 'crypto';

export interface ChannelCredentials {
    accessToken: string;
    phoneNumberId: string;
    wabaId: string;
    channelId: string;
}

export interface GenericChannelCredentials {
    accessToken: string;
    accountId: string;
    channelType: string;
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
        private cryptoService: WhatsappCryptoService,
    ) {}

    /**
     * Get valid access token for a tenant's WhatsApp channel.
     * Cached in Redis for 5 minutes.
     */
    async getWhatsAppToken(tenantId: string): Promise<ChannelCredentials> {
        const cacheKey = `wa_token:${tenantId}`;
        const cached = await this.redis.getJson<ChannelCredentials>(cacheKey);
        if (cached) return cached;

        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

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
            accessToken = this.cryptoService.decryptToken(cred.encryptedValue);
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

    /**
     * Get access token for any channel type (Instagram, Messenger, Telegram).
     * Looks up the ChannelAccount + WhatsappCredential by channelType.
     */
    async getChannelToken(tenantId: string, channelType: string): Promise<GenericChannelCredentials> {
        // WhatsApp has its own dedicated resolution path
        if (channelType === 'whatsapp') {
            const wa = await this.getWhatsAppToken(tenantId);
            return { accessToken: wa.accessToken, accountId: wa.phoneNumberId, channelType };
        }

        const cacheKey = `${channelType}_token:${tenantId}`;
        const cached = await this.redis.getJson<GenericChannelCredentials>(cacheKey);
        if (cached) return cached;

        // 1. Find the channel account for this tenant + channel type
        const account = await this.prisma.channelAccount.findFirst({
            where: { tenantId, channelType, isActive: true },
            select: { accountId: true, accessToken: true },
        });

        if (!account) {
            throw new Error(`No ${channelType} channel connected for tenant ${tenantId}`);
        }

        // 2. Try encrypted credential from whatsapp_credentials table
        const credType = `${channelType}_token`; // instagram_token, messenger_token
        const cred = await this.prisma.whatsappCredential.findFirst({
            where: { tenantId, credentialType: credType },
            orderBy: { createdAt: 'desc' },
        });

        let accessToken: string;
        if (cred?.encryptedValue) {
            try {
                accessToken = this.cryptoService.decryptToken(cred.encryptedValue);
            } catch (e: any) {
                this.logger.error(`Failed to decrypt ${channelType} token for tenant ${tenantId}: ${e.message}`);
                throw new Error(`Failed to decrypt ${channelType} token: ${e.message}`);
            }
        } else if (account.accessToken && account.accessToken !== 'encrypted_ref') {
            try {
                accessToken = this.cryptoService.decryptToken(account.accessToken);
            } catch (e: any) {
                this.logger.error(`Failed to decrypt ${channelType} fallback token: ${e.message}`);
                throw new Error(`Failed to decrypt ${channelType} token: ${e.message}`);
            }
        } else {
            throw new Error(`No ${channelType} credentials for tenant ${tenantId}`);
        }

        const result: GenericChannelCredentials = { accessToken, accountId: account.accountId, channelType };
        await this.redis.setJson(cacheKey, result, this.CACHE_TTL);
        return result;
    }

    /** Invalidate cached token for a channel+tenant */
    async invalidateCache(channelType: string, tenantId: string): Promise<void> {
        const cacheKey = `${channelType}_token:${tenantId}`;
        await this.redis.del(cacheKey);
    }
}
