import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { ChannelTokenService } from './channel-token.service';
import { CronLockService } from '../redis/cron-lock.service';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../quality/agent-quality-events';

/**
 * Instagram long-lived tokens expire after 60 days.
 * This cron refreshes tokens that are within 30 days of expiration
 * to prevent silent disconnection.
 *
 * Multi-account aware: iterates every active Instagram connection in
 * `channel_accounts` and writes the refreshed token back to
 * `channel_accounts.access_token` — the per-account slot the runtime actually
 * reads (ChannelTokenService.getChannelToken prefers it). It also keeps the
 * legacy `whatsapp_credentials.instagram_token` in sync (fallback + status UI),
 * and self-heals pre-multi-account rows that still hold the 'encrypted_ref'
 * placeholder by upgrading them to a real per-account token.
 */
@Injectable()
export class InstagramTokenRefreshService {
    private readonly logger = new Logger(InstagramTokenRefreshService.name);

    constructor(
        private prisma: PrismaService,
        private cryptoService: WhatsappCryptoService,
        private channelToken: ChannelTokenService,
        private readonly cronLock: CronLockService,
        @Optional() private readonly events?: EventEmitter2,
    ) {}

    /** Daily at 6AM — refresh IG tokens expiring within 30 days */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('0 6 * * *')
    async refreshExpiringSoonTokensCron() {
        await this.cronLock.runExclusive('instagram-token-refresh.refreshExpiringSoonTokens', 3600, () => this.refreshExpiringSoonTokens());
    }

    async refreshExpiringSoonTokens() {
        const now = Date.now();
        const thresholdMs = 30 * 24 * 60 * 60 * 1000; // 30 days

        const accounts = await this.prisma.channelAccount.findMany({
            where: { channelType: 'instagram', isActive: true },
        });
        if (accounts.length === 0) return;

        let refreshed = 0;
        for (const acc of accounts) {
            const lease = randomUUID();
            let started = false;
            try {
                const meta = ((acc.metadata as Record<string, any>) || {});

                // Resolve the CURRENT token the same way runtime does: prefer the
                // per-account token, fall back to the shared legacy credential.
                let currentToken: string | null = null;
                const hasRealAccountToken =
                    !!acc.accessToken && acc.accessToken !== 'encrypted_ref' && acc.accessToken !== 'credential_ref';
                if (hasRealAccountToken) {
                    try { currentToken = this.cryptoService.decryptToken(acc.accessToken); } catch { currentToken = null; }
                }
                const cred = await this.prisma.whatsappCredential.findFirst({
                    where: { tenantId: acc.tenantId, credentialType: 'instagram_token' },
                    orderBy: { createdAt: 'desc' },
                });
                if (!currentToken && cred?.encryptedValue) {
                    try { currentToken = this.cryptoService.decryptToken(cred.encryptedValue); } catch { currentToken = null; }
                }
                if (!currentToken) continue;

                // Expiry: per-account metadata first, else the legacy credential's expiry.
                const expMs = meta.tokenExpiresAt
                    ? new Date(meta.tokenExpiresAt).getTime()
                    : (cred?.expiresAt ? new Date(cred.expiresAt).getTime() : null);
                // Refresh when expiry is unknown (never tracked) or within the window.
                if (expMs !== null && (expMs - now) > thresholdMs) continue;

                const claims = await this.prisma.$queryRawUnsafe<any[]>(
                    `UPDATE channel_accounts
                     SET token_refresh_state = 'claimed',
                         token_refresh_attempts = token_refresh_attempts + 1,
                         token_refresh_lease_token = $2::uuid,
                         token_refresh_lease_expires_at = NOW() + INTERVAL '90 seconds',
                         token_refresh_error = NULL
                     WHERE id = $1::uuid
                       AND is_active = true
                       AND channel_type = 'instagram'
                       AND ((token_refresh_state IN ('idle', 'failed', 'unknown')
                              AND (token_refresh_started_at IS NULL
                                OR token_refresh_started_at <= NOW() - INTERVAL '23 hours'))
                         OR (token_refresh_state IN ('claimed', 'sending')
                              AND token_refresh_lease_expires_at <= NOW()))
                     RETURNING id`,
                    acc.id,
                    lease,
                );
                if (!claims[0]) continue;

                const began = await this.prisma.$executeRawUnsafe(
                    `UPDATE channel_accounts
                     SET token_refresh_state = 'sending', token_refresh_started_at = NOW()
                     WHERE id = $1::uuid
                       AND token_refresh_state = 'claimed'
                       AND token_refresh_lease_token = $2::uuid
                       AND token_refresh_lease_expires_at > NOW()`,
                    acc.id,
                    lease,
                );
                if (Number(began) !== 1) continue;
                started = true;

                const res = await fetch(
                    `https://graph.instagram.com/refresh_access_token?` +
                    new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: currentToken }),
                );
                const data = await res.json() as any;

                if (!data.access_token) {
                    this.logger.warn(`IG token refresh failed for tenant ${acc.tenantId} account ${acc.accountId}: ${JSON.stringify(data.error || data)}`);
                    await this.prisma.$executeRawUnsafe(
                        `UPDATE channel_accounts
                         SET token_refresh_state = 'failed',
                             token_refresh_lease_token = NULL,
                             token_refresh_lease_expires_at = NULL,
                             token_refresh_completed_at = NOW(),
                             token_refresh_error = 'instagram_refresh_refused'
                         WHERE id = $1::uuid
                           AND token_refresh_state = 'sending'
                           AND token_refresh_lease_token = $2::uuid`,
                        acc.id,
                        lease,
                    );
                    continue;
                }

                const newExpiresAt = new Date(now + (data.expires_in || 5184000) * 1000);
                const encrypted = this.cryptoService.encryptToken(data.access_token);

                // Write the refreshed token to the per-account slot the runtime reads
                // (also upgrades legacy placeholder rows to a real per-account token).
                await this.prisma.$transaction(async (tx: any) => {
                    const settled = await tx.$executeRawUnsafe(
                        `UPDATE channel_accounts
                         SET access_token = $3,
                             metadata = $4::jsonb,
                             token_refresh_state = 'idle',
                             token_refresh_lease_token = NULL,
                             token_refresh_lease_expires_at = NULL,
                             token_refresh_completed_at = NOW(),
                             token_refresh_error = NULL,
                             updated_at = NOW()
                         WHERE id = $1::uuid
                           AND token_refresh_state = 'sending'
                           AND token_refresh_lease_token = $2::uuid`,
                        acc.id,
                        lease,
                        encrypted,
                        JSON.stringify({ ...meta, tokenExpiresAt: newExpiresAt.toISOString() }),
                    );
                    if (Number(settled) !== 1) throw new Error('instagram_refresh_lease_lost');
                    await tx.whatsappCredential.updateMany({
                        where: { tenantId: acc.tenantId, credentialType: 'instagram_token' },
                        data: {
                            encryptedValue: encrypted,
                            expiresAt: newExpiresAt,
                            rotationState: 'active',
                            updatedAt: new Date(),
                        },
                    });
                });
                await this.channelToken.invalidateCache('instagram', acc.tenantId, acc.accountId).catch(() => {});
                this.events?.emit(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
                    tenantId: acc.tenantId,
                    source: 'channel_credential',
                });

                refreshed++;
                this.logger.log(`IG token refreshed for tenant ${acc.tenantId} account ${acc.accountId}, new expiry: ${newExpiresAt.toISOString()}`);
            } catch (e: any) {
                await this.prisma.$executeRawUnsafe(
                    `UPDATE channel_accounts
                     SET token_refresh_state = $3,
                         token_refresh_lease_token = NULL,
                         token_refresh_lease_expires_at = NULL,
                         token_refresh_completed_at = NOW(),
                         token_refresh_error = $4
                     WHERE id = $1::uuid AND token_refresh_lease_token = $2::uuid`,
                    acc.id,
                    lease,
                    started ? 'unknown' : 'failed',
                    String(e?.message || 'instagram_refresh_failed').slice(0, 200),
                ).catch(() => undefined);
                this.logger.error(`IG token refresh error for tenant ${acc.tenantId} account ${acc.accountId}: ${e.message}`);
            }
        }
        if (refreshed) this.logger.log(`Refreshed ${refreshed} Instagram token(s)`);
    }
}
