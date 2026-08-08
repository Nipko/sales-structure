import { BadRequestException, ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { parseSafeHttpsUrl, pinSafeHttpsUrl } from '../../common/utils/safe-outbound-url.util';
import {
    IsolatedWebPushExecutor,
    WEB_PUSH_MAX_SUBSCRIPTIONS_PER_DISPATCH,
    EXPO_PUSH_MAX_REQUEST_BYTES,
    assertAllowlistedPushServiceHostname,
    assertBoundedWebPushPayload,
    readBoundedPushJsonResponse,
    withPushAbsoluteDeadline,
} from './web-push-isolation';

/**
 * A PushSubscription endpoint is supplied by an authenticated browser, but its
 * API payload can be tampered with. Only known browser push services are legal;
 * their public address is resolved once and passed to the isolated worker.
 */
export async function prepareTrustedWebPushTarget(rawEndpoint: unknown) {
    const parsed = parseSafeHttpsUrl(rawEndpoint, 'suscripcion push');
    assertAllowlistedPushServiceHostname(parsed.hostname);
    return pinSafeHttpsUrl(parsed, 'suscripcion push');
}

@Injectable()
export class PushService implements OnModuleInit {
    private readonly logger = new Logger(PushService.name);
    private enabled = false;
    private vapidDetails?: { subject: string; publicKey: string; privateKey: string };
    private readonly webPushExecutor = new IsolatedWebPushExecutor();

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
    ) {}

    onModuleInit() {
        const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
        const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');

        if (publicKey && privateKey) {
            this.vapidDetails = {
                subject: 'mailto:soporte@parallly-chat.cloud', publicKey, privateKey,
            };
            this.enabled = true;
            this.logger.log('Web Push configured with VAPID keys');
        } else {
            this.logger.warn('VAPID keys not configured — push notifications disabled');
        }
    }

    async subscribe(userId: string, tenantId: string, subscription: any): Promise<void> {
        const p256dh = subscription?.keys?.p256dh;
        const auth = subscription?.keys?.auth;
        if (typeof p256dh !== 'string' || !p256dh || p256dh.length > 512
            || typeof auth !== 'string' || !auth || auth.length > 512) {
            throw new BadRequestException('Claves de suscripcion push invalidas');
        }
        const target = await prepareTrustedWebPushTarget(subscription?.endpoint);
        const endpoint = target.url.toString();
        target.httpsAgent.destroy();
        const rows = await this.prisma.$queryRawUnsafe(
            `INSERT INTO public.push_subscriptions AS ps (user_id, tenant_id, endpoint, keys, created_at)
             VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, NOW())
             ON CONFLICT (endpoint) DO UPDATE SET keys = EXCLUDED.keys, created_at = NOW()
             WHERE ps.user_id = EXCLUDED.user_id AND ps.tenant_id = EXCLUDED.tenant_id
            RETURNING endpoint`,
            userId, tenantId, endpoint,
            JSON.stringify({ p256dh, auth }),
        ) as any[];
        if (!rows?.length) {
            throw new ConflictException('La suscripcion push ya pertenece a otra cuenta');
        }
    }

    async unsubscribe(userId: string, tenantId: string, endpoint: string): Promise<void> {
        await this.prisma.$queryRawUnsafe(
            `DELETE FROM public.push_subscriptions
              WHERE endpoint = $1 AND user_id = $2::uuid AND tenant_id = $3::uuid`,
            endpoint, userId, tenantId,
        );
    }

    private async deleteStoredSubscription(endpoint: string, userId: string, tenantId: string): Promise<void> {
        await this.unsubscribe(userId, tenantId, endpoint);
    }

    /** Register a native Expo push token (provider='expo'). */
    async subscribeExpo(userId: string, tenantId: string, token: string): Promise<void> {
        if (!token) return;
        if (typeof token !== 'string' || token.length > 512) {
            throw new BadRequestException('Token Expo invalido');
        }
        await this.ensurePushTable();
        const rows = await this.prisma.$queryRawUnsafe(
            `INSERT INTO public.push_subscriptions AS ps (user_id, tenant_id, endpoint, keys, provider, created_at)
             VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb, 'expo', NOW())
             ON CONFLICT (endpoint) DO UPDATE SET provider = 'expo', created_at = NOW()
             WHERE ps.user_id = EXCLUDED.user_id AND ps.tenant_id = EXCLUDED.tenant_id
             RETURNING endpoint`,
            userId, tenantId, token,
        ) as any[];
        if (!rows?.length) {
            throw new ConflictException('El token push ya pertenece a otra cuenta');
        }
    }

    async sendToUser(userId: string, payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
        let cursor: string | null = null;
        let sent = 0;
        do {
            const subs: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT id, endpoint, keys, user_id, tenant_id, COALESCE(provider, 'webpush') AS provider
                 FROM public.push_subscriptions
                 WHERE user_id = $1::uuid
                   AND ($2::uuid IS NULL OR id > $2::uuid)
                 ORDER BY id
                 LIMIT $3`,
                userId, cursor, WEB_PUSH_MAX_SUBSCRIPTIONS_PER_DISPATCH,
            );
            if (!subs?.length) break;
            sent += await this.dispatch(subs, payload);
            cursor = subs[subs.length - 1].id;
            if (subs.length < WEB_PUSH_MAX_SUBSCRIPTIONS_PER_DISPATCH) break;
        } while (cursor);
        return sent;
    }

    async sendToTenantRole(tenantId: string, role: string, payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
        let cursor: string | null = null;
        let sent = 0;
        do {
            const subs: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT ps.id, ps.endpoint, ps.keys, ps.user_id, ps.tenant_id,
                        COALESCE(ps.provider, 'webpush') AS provider
                 FROM public.push_subscriptions ps
                 JOIN public.users u ON u.id = ps.user_id
                 WHERE ps.tenant_id = $1::uuid AND u.role = $2 AND u.is_active = true
                   AND ($3::uuid IS NULL OR ps.id > $3::uuid)
                 ORDER BY ps.id
                 LIMIT $4`,
                tenantId, role, cursor, WEB_PUSH_MAX_SUBSCRIPTIONS_PER_DISPATCH,
            );
            if (!subs?.length) break;
            sent += await this.dispatch(subs, payload);
            cursor = subs[subs.length - 1].id;
            if (subs.length < WEB_PUSH_MAX_SUBSCRIPTIONS_PER_DISPATCH) break;
        } while (cursor);
        return sent;
    }

    /** Dispatch a payload to mixed web-push + native Expo subscriptions. */
    private async dispatch(subs: any[], payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
        let sent = 0;
        const expoTokens: string[] = [];
        const boundedSubs = subs || [];
        if (boundedSubs.length > WEB_PUSH_MAX_SUBSCRIPTIONS_PER_DISPATCH) {
            throw new Error(`Push dispatch exceeds the ${WEB_PUSH_MAX_SUBSCRIPTIONS_PER_DISPATCH}-subscription memory cap`);
        }
        const serializedPayload = JSON.stringify(payload);
        // Validate once outside the per-subscription catch. An oversized product
        // payload is not evidence that a browser subscription is stale.
        assertBoundedWebPushPayload(serializedPayload);

        for (const sub of boundedSubs) {
            if (sub.provider === 'expo') { expoTokens.push(sub.endpoint); continue; }
            if (!this.enabled) continue; // web-push needs VAPID
            let target: Awaited<ReturnType<typeof prepareTrustedWebPushTarget>> | undefined;
            try {
                target = await prepareTrustedWebPushTarget(sub.endpoint);
                const keys = typeof sub.keys === 'string' ? JSON.parse(sub.keys) : sub.keys;
                if (!this.vapidDetails) continue;
                await this.webPushExecutor.send({
                    endpoint: target.url.toString(),
                    hostname: target.hostname,
                    address: target.address,
                    family: target.family,
                    keys,
                    payload: serializedPayload,
                    vapidDetails: this.vapidDetails,
                });
                sent++;
            } catch (err: any) {
                if (err instanceof BadRequestException || err.statusCode === 410 || err.statusCode === 404) {
                    await this.deleteStoredSubscription(sub.endpoint, sub.user_id, sub.tenant_id);
                } else {
                    this.logger.warn(`Web push to ${String(sub.endpoint).slice(0, 40)}… failed: ${err.message}`);
                }
            } finally {
                target?.httpsAgent.destroy();
            }
        }

        if (expoTokens.length > 0) sent += await this.sendExpo(expoTokens, payload);
        return sent;
    }

    /** Send via the Expo Push API (native FCM/APNS — no VAPID needed). */
    private async sendExpo(tokens: string[], payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
        try {
            // Derive the conversationId from the tag (msg-/handoff-/sla-<id>) so the
            // mobile app can deep-link straight to the conversation on tap.
            const tagMatch = /^(?:msg|handoff|sla)-(.+)$/.exec(payload.tag || '');
            const conversationId = tagMatch ? tagMatch[1] : undefined;
            const messages = tokens.map((to) => ({
                to,
                title: payload.title,
                body: payload.body,
                sound: 'default',
                channelId: 'default',
                // Surfaces the "Responder / Abrir" quick actions on the notification
                // (the mobile app registers the 'message' category).
                ...(conversationId ? { categoryId: 'message' } : {}),
                data: { url: payload.url, tag: payload.tag, conversationId },
            }));
            const requestBody = JSON.stringify(messages);
            if (Buffer.byteLength(requestBody, 'utf8') > EXPO_PUSH_MAX_REQUEST_BYTES) {
                throw new Error('Expo push request exceeded memory cap');
            }
            const data: any = await withPushAbsoluteDeadline(async (signal) => {
                const res = await fetch('https://exp.host/--/api/v2/push/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: requestBody,
                    signal,
                });
                if (!res.ok) throw new Error(`Expo push provider returned ${res.status}`);
                return readBoundedPushJsonResponse(res);
            });
            const tickets: any[] = Array.isArray(data?.data) ? data.data : [];
            tickets.forEach((t, i) => {
                if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered') {
                    this.deleteExpoSubscription(tokens[i]).catch(() => {});
                }
            });
            return tokens.length;
        } catch (err: any) {
            this.logger.warn(`Expo push failed: ${err.message}`);
            return 0;
        }
    }

    private async deleteExpoSubscription(token: string): Promise<void> {
        await this.prisma.$queryRawUnsafe(
            `DELETE FROM public.push_subscriptions WHERE endpoint = $1 AND provider = 'expo'`,
            token,
        );
    }

    async ensurePushTable(): Promise<void> {
        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS public.push_subscriptions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                tenant_id UUID NOT NULL,
                endpoint TEXT NOT NULL UNIQUE,
                keys JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await this.prisma.$queryRawUnsafe(
            `ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'webpush'`,
        ).catch(() => {});
        await this.prisma.$queryRawUnsafe(`
            CREATE INDEX IF NOT EXISTS idx_push_subs_user ON public.push_subscriptions(user_id)
        `);
    }
}
