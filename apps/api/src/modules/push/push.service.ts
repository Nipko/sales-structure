import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as webpush from 'web-push';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PushService implements OnModuleInit {
    private readonly logger = new Logger(PushService.name);
    private enabled = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
    ) {}

    onModuleInit() {
        const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
        const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');

        if (publicKey && privateKey) {
            webpush.setVapidDetails(
                'mailto:soporte@parallly-chat.cloud',
                publicKey,
                privateKey,
            );
            this.enabled = true;
            this.logger.log('Web Push configured with VAPID keys');
        } else {
            this.logger.warn('VAPID keys not configured — push notifications disabled');
        }
    }

    async subscribe(userId: string, tenantId: string, subscription: any): Promise<void> {
        await this.prisma.$queryRawUnsafe(
            `INSERT INTO public.push_subscriptions (user_id, tenant_id, endpoint, keys, created_at)
             VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, NOW())
             ON CONFLICT (endpoint) DO UPDATE SET user_id = $1::uuid, tenant_id = $2::uuid, keys = $4::jsonb`,
            userId, tenantId, subscription.endpoint,
            JSON.stringify({ p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }),
        );
    }

    async unsubscribe(endpoint: string): Promise<void> {
        await this.prisma.$queryRawUnsafe(
            `DELETE FROM public.push_subscriptions WHERE endpoint = $1`,
            endpoint,
        );
    }

    /** Register a native Expo push token (provider='expo'). */
    async subscribeExpo(userId: string, tenantId: string, token: string): Promise<void> {
        if (!token) return;
        await this.ensurePushTable();
        await this.prisma.$queryRawUnsafe(
            `INSERT INTO public.push_subscriptions (user_id, tenant_id, endpoint, keys, provider, created_at)
             VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb, 'expo', NOW())
             ON CONFLICT (endpoint) DO UPDATE SET user_id = $1::uuid, tenant_id = $2::uuid, provider = 'expo'`,
            userId, tenantId, token,
        );
    }

    async sendToUser(userId: string, payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
        const subs: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT endpoint, keys, COALESCE(provider, 'webpush') AS provider
             FROM public.push_subscriptions WHERE user_id = $1::uuid`,
            userId,
        );
        return this.dispatch(subs, payload);
    }

    async sendToTenantRole(tenantId: string, role: string, payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
        const subs: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT ps.endpoint, ps.keys, COALESCE(ps.provider, 'webpush') AS provider
             FROM public.push_subscriptions ps
             JOIN public.users u ON u.id = ps.user_id
             WHERE ps.tenant_id = $1::uuid AND u.role = $2 AND u.is_active = true`,
            tenantId, role,
        );
        return this.dispatch(subs, payload);
    }

    /** Dispatch a payload to mixed web-push + native Expo subscriptions. */
    private async dispatch(subs: any[], payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
        let sent = 0;
        const expoTokens: string[] = [];

        for (const sub of subs) {
            if (sub.provider === 'expo') { expoTokens.push(sub.endpoint); continue; }
            if (!this.enabled) continue; // web-push needs VAPID
            try {
                const keys = typeof sub.keys === 'string' ? JSON.parse(sub.keys) : sub.keys;
                await webpush.sendNotification({ endpoint: sub.endpoint, keys }, JSON.stringify(payload));
                sent++;
            } catch (err: any) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await this.unsubscribe(sub.endpoint);
                } else {
                    this.logger.warn(`Web push to ${String(sub.endpoint).slice(0, 40)}… failed: ${err.message}`);
                }
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
                data: { url: payload.url, tag: payload.tag, conversationId },
            }));
            const res = await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(messages),
            });
            const data: any = await res.json().catch(() => ({}));
            const tickets: any[] = Array.isArray(data?.data) ? data.data : [];
            tickets.forEach((t, i) => {
                if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered') {
                    this.unsubscribe(tokens[i]).catch(() => {});
                }
            });
            return tokens.length;
        } catch (err: any) {
            this.logger.warn(`Expo push failed: ${err.message}`);
            return 0;
        }
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
