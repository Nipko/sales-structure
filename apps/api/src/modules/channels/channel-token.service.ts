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
     *
     * `phoneNumberId` selects a SPECIFIC number when a tenant has more than one
     * connected (multi-account). The system_user_token is tenant-wide under the
     * Tech Provider model, so only the whatsapp_channels row (WABA/number) is
     * resolved per number — no more arbitrary `LIMIT 1`.
     */
    async getWhatsAppToken(tenantId: string, phoneNumberId?: string): Promise<ChannelCredentials> {
        const cacheKey = phoneNumberId ? `wa_token:${tenantId}:${phoneNumberId}` : `wa_token:${tenantId}`;
        const cached = await this.redis.getJson<ChannelCredentials>(cacheKey);
        if (cached) return cached;

        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        // 1. Channel info — the specific number when given, else the oldest
        //    (stable, deterministic) channel of the tenant.
        let channels: any[] = [];
        if (phoneNumberId) {
            channels = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, phone_number_id, meta_waba_id, access_token_ref FROM whatsapp_channels WHERE phone_number_id = $1 LIMIT 1`,
                [phoneNumberId],
            );
        }
        if (!channels?.length) {
            channels = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, phone_number_id, meta_waba_id, access_token_ref FROM whatsapp_channels ORDER BY connected_at ASC NULLS LAST LIMIT 1`,
            );
        }
        if (!channels?.length) {
            throw new Error(`No WhatsApp channel for tenant ${tenantId}`);
        }
        const channel = channels[0];

        // If a specific number was requested but not found, we degraded to another
        // channel — warn, and below avoid caching under the requested (wrong) key.
        const requestedButMissing = !!phoneNumberId && channel.phone_number_id !== phoneNumberId;
        if (requestedButMissing) {
            this.logger.warn(`getWhatsAppToken: requested phone_number_id ${phoneNumberId} not found for tenant ${tenantId}; using ${channel.phone_number_id}`);
        }

        // 2. Encrypted credential from global table (tenant-wide system user token)
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

        // Don't poison the requested-number key with a fallback number's creds.
        const writeKey = requestedButMissing ? `wa_token:${tenantId}:${channel.phone_number_id}` : cacheKey;
        await this.redis.setJson(writeKey, result, this.CACHE_TTL);
        return result;
    }

    /**
     * Get access token for any channel type (Instagram, Messenger, Telegram, SMS).
     *
     * `accountId` selects a SPECIFIC connected account when a tenant has more than
     * one of the same type (multi-account). Resolution PREFERS the per-account
     * token stored on the channel_accounts row (the connect flow writes the real
     * encrypted token there); legacy rows hold the 'encrypted_ref' placeholder and
     * fall back to the shared whatsapp_credentials token.
     */
    async getChannelToken(tenantId: string, channelType: string, accountId?: string): Promise<GenericChannelCredentials> {
        // WhatsApp has its own dedicated resolution path
        if (channelType === 'whatsapp') {
            const wa = await this.getWhatsAppToken(tenantId, accountId);
            return { accessToken: wa.accessToken, accountId: wa.phoneNumberId, channelType };
        }

        const cacheKey = accountId ? `${channelType}_token:${tenantId}:${accountId}` : `${channelType}_token:${tenantId}`;
        const cached = await this.redis.getJson<GenericChannelCredentials>(cacheKey);
        if (cached) return cached;

        // 1. Find the channel account — the specific one when accountId is given,
        //    else the first active (legacy single-account behavior).
        const account = accountId
            ? await this.prisma.channelAccount.findFirst({
                where: { tenantId, channelType, accountId, isActive: true },
                select: { accountId: true, accessToken: true },
            })
            : await this.prisma.channelAccount.findFirst({
                where: { tenantId, channelType, isActive: true },
                select: { accountId: true, accessToken: true },
                // Sin `orderBy`, "la primera cuenta activa" no está definida:
                // Postgres devuelve el orden físico, que cambia cada vez que la
                // fila se reescribe (connect, disconnect, refresh de token de
                // IG). Con 2 cuentas del mismo tipo la elegida alternaba entre
                // llamadas, así que los envíos auxiliares sin conversación en
                // contexto —recordatorios, recalls, nurturing— salían unas veces
                // por una cuenta y otras por la otra. En Instagram y Messenger
                // eso ni siquiera degrada: el PSID/IGSID está scopeado a la
                // página, así que el envío falla de plano.
                //
                // La más antigua, igual que el camino propio de WhatsApp de más
                // arriba (ORDER BY connected_at ASC).
                orderBy: { createdAt: 'asc' },
            });

        if (!account) {
            throw new Error(`No ${channelType} channel connected for tenant ${tenantId}${accountId ? ` (account ${accountId})` : ''}`);
        }

        let accessToken: string;
        // PREFER the per-account token on the account row (new connect flow). Legacy
        // rows have the 'encrypted_ref'/'credential_ref' placeholder → shared credential.
        if (account.accessToken && account.accessToken !== 'encrypted_ref' && account.accessToken !== 'credential_ref') {
            try {
                accessToken = this.cryptoService.decryptToken(account.accessToken);
            } catch (e: any) {
                this.logger.error(`Failed to decrypt per-account ${channelType} token for tenant ${tenantId}: ${e.message}`);
                throw new Error(`Failed to decrypt ${channelType} token: ${e.message}`);
            }
        } else {
            const credType = `${channelType}_token`; // instagram_token, messenger_token, ...
            const cred = await this.prisma.whatsappCredential.findFirst({
                where: { tenantId, credentialType: credType },
                orderBy: { createdAt: 'desc' },
            });
            if (cred?.encryptedValue) {
                try {
                    accessToken = this.cryptoService.decryptToken(cred.encryptedValue);
                } catch (e: any) {
                    this.logger.error(`Failed to decrypt ${channelType} token for tenant ${tenantId}: ${e.message}`);
                    throw new Error(`Failed to decrypt ${channelType} token: ${e.message}`);
                }
            } else {
                throw new Error(`No ${channelType} credentials for tenant ${tenantId}`);
            }
        }

        const result: GenericChannelCredentials = { accessToken, accountId: account.accountId, channelType };
        await this.redis.setJson(cacheKey, result, this.CACHE_TTL);
        return result;
    }

    /**
     * Invalidate cached token(s) for a channel+tenant. Clears the base key and,
     * when `accountId` is given, the per-account key too. (Per-account keys carry
     * a 5-min TTL, so any not explicitly cleared expire quickly on their own.)
     */
    async invalidateCache(channelType: string, tenantId: string, accountId?: string): Promise<void> {
        await this.redis.del(`${channelType}_token:${tenantId}`);
        if (accountId) await this.redis.del(`${channelType}_token:${tenantId}:${accountId}`);
        if (channelType === 'whatsapp') {
            await this.redis.del(`wa_token:${tenantId}`);
            if (accountId) await this.redis.del(`wa_token:${tenantId}:${accountId}`);
        }
    }
}
