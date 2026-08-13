import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../quality/agent-quality-events';

/**
 * Reconciles the STORED state of WhatsApp credentials against Meta's own view.
 *
 * Why this exists: nothing was verifying WhatsApp tokens. Instagram has a
 * refresh cron (60-day tokens), but WhatsApp credentials were written once at
 * onboarding and never revisited, so `expires_at` and `rotation_state` were
 * whatever the onboarding happened to store — including a stale expiry left
 * behind when a 60-day token was upgraded to a permanent System User one. The
 * monitor then alerted on that stale date and asked an operator to re-authorise
 * a token that never expires.
 *
 * There is nothing to "renew" here on purpose:
 *  - A System User token is PERMANENT. Meta issues no refresh for it, and none
 *    is needed — the correct action is to verify it still works.
 *  - The 60-day long-lived USER token (the fallback when SYSTEM_USER_ID is not
 *    configured) cannot be refreshed without the user re-authorising; Meta does
 *    not expose a refresh grant for it. Re-authorisation genuinely is the only
 *    fix, and the real remedy is to configure SYSTEM_USER_ID so the permanent
 *    token is obtained instead.
 *
 * So this asks Meta the only question that matters — "is this token still
 * valid, and when does it actually expire?" — and writes the answer back, so
 * alerts reflect reality instead of a guess made months ago.
 */
@Injectable()
export class WhatsappTokenHealthService {
    private readonly logger = new Logger(WhatsappTokenHealthService.name);

    constructor(
        private prisma: PrismaService,
        private crypto: WhatsappCryptoService,
        private config: ConfigService,
        @Optional() private readonly events?: EventEmitter2,
    ) {}

    /** Daily at 5AM, before the monitor's alerting windows. */
    @Cron('0 5 * * *')
    async verifyStoredCredentials(): Promise<void> {
        const appId = this.config.get<string>('META_APP_ID');
        const appSecret = this.config.get<string>('META_APP_SECRET');
        if (!appId || !appSecret) {
            this.logger.warn('META_APP_ID/SECRET not configured — skipping WhatsApp token verification');
            return;
        }

        let creds: Array<{ id: string; tenantId: string; encryptedValue: string; expiresAt: Date | null; rotationState: string }>;
        try {
            creds = await this.prisma.whatsappCredential.findMany({
                where: { credentialType: 'system_user_token', rotationState: { in: ['active', 'error'] } },
                select: { id: true, tenantId: true, encryptedValue: true, expiresAt: true, rotationState: true },
            }) as any;
        } catch (e: any) {
            this.logger.warn(`Could not list WhatsApp credentials: ${e.message}`);
            return;
        }
        if (creds.length === 0) return;

        let healed = 0;
        let broken = 0;

        for (const cred of creds) {
            try {
                const token = this.crypto.decryptToken(cred.encryptedValue);
                if (!token) continue;

                const res = await fetch(
                    `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(token)}` +
                    `&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
                );
                const body: any = await res.json();
                const info = body?.data;
                if (!info) {
                    this.logger.warn(`[TokenHealth] tenant ${cred.tenantId}: debug_token returned no data`);
                    continue;
                }

                // expires_at = 0 (or absent) means the token never expires — the
                // shape a System User token has.
                const expiresAtUnix = Number(info.expires_at) || 0;
                const realExpiry = expiresAtUnix > 0 ? new Date(expiresAtUnix * 1000) : null;
                const isValid = info.is_valid === true;

                const nextState = isValid ? 'active' : 'error';
                const expiryChanged =
                    (realExpiry?.getTime() ?? null) !== (cred.expiresAt?.getTime() ?? null);

                if (nextState !== cred.rotationState || expiryChanged) {
                    await this.prisma.whatsappCredential.update({
                        where: { id: cred.id },
                        data: { rotationState: nextState, expiresAt: realExpiry },
                    });
                    this.events?.emit(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
                        tenantId: cred.tenantId,
                        source: 'channel_credential',
                    });
                    healed++;
                    this.logger.log(
                        `[TokenHealth] tenant ${cred.tenantId}: state=${nextState} ` +
                        `expiry=${realExpiry ? realExpiry.toISOString() : 'never'} (was ${cred.expiresAt?.toISOString() ?? 'never'})`,
                    );
                }

                if (!isValid) {
                    broken++;
                    this.logger.error(
                        `[TokenHealth] tenant ${cred.tenantId}: WhatsApp token is NO LONGER VALID ` +
                        `(${info.error?.message || 'no reason given'}) — the channel needs re-authorisation`,
                    );
                }
            } catch (e: any) {
                // Never let one tenant's failure stop the sweep.
                this.logger.warn(`[TokenHealth] tenant ${cred.tenantId}: verification failed: ${e.message}`);
            }
        }

        if (healed > 0 || broken > 0) {
            this.logger.log(`[TokenHealth] verified ${creds.length} credential(s): ${healed} corrected, ${broken} invalid`);
        }
    }
}
