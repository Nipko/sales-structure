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

    async sendToUser(userId: string, payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
        if (!this.enabled) return 0;

        const subs: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT endpoint, keys FROM public.push_subscriptions WHERE user_id = $1::uuid`,
            userId,
        );

        let sent = 0;
        for (const sub of subs) {
            try {
                const keys = typeof sub.keys === 'string' ? JSON.parse(sub.keys) : sub.keys;
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys },
                    JSON.stringify(payload),
                );
                sent++;
            } catch (err: any) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await this.unsubscribe(sub.endpoint);
                } else {
                    this.logger.warn(`Push to ${sub.endpoint.slice(0, 40)}… failed: ${err.message}`);
                }
            }
        }
        return sent;
    }

    async sendToTenantRole(tenantId: string, role: string, payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
        if (!this.enabled) return 0;

        const users: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT ps.endpoint, ps.keys
             FROM public.push_subscriptions ps
             JOIN public.users u ON u.id = ps.user_id
             WHERE ps.tenant_id = $1::uuid AND u.role = $2 AND u.is_active = true`,
            tenantId, role,
        );

        let sent = 0;
        for (const sub of users) {
            try {
                const keys = typeof sub.keys === 'string' ? JSON.parse(sub.keys) : sub.keys;
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys },
                    JSON.stringify(payload),
                );
                sent++;
            } catch (err: any) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await this.unsubscribe(sub.endpoint);
                }
            }
        }
        return sent;
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
        await this.prisma.$queryRawUnsafe(`
            CREATE INDEX IF NOT EXISTS idx_push_subs_user ON public.push_subscriptions(user_id)
        `);
    }
}
