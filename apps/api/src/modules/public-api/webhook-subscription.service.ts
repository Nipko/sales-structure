import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import * as crypto from 'crypto';
import {
    type PinnedHttpsTarget,
    prepareSafeHttpsTarget,
    safeAxiosOptions,
} from '../../common/utils/safe-outbound-url.util';

export const ZAPIER_HOOK_EVENTS = [
    'lead.created',
    'message.received',
    'conversation.closed',
    'deal.stage_changed',
    'appointment.booked',
] as const;

export type ZapierHookEvent = (typeof ZAPIER_HOOK_EVENTS)[number];

export interface WebhookSubscription {
    id: string;
    tenant_id: string;
    target_url: string;
    event: string;
    secret: string;
    is_active: boolean;
    created_at: string;
    last_triggered_at: string | null;
}

@Injectable()
export class WebhookSubscriptionService {
    private readonly logger = new Logger(WebhookSubscriptionService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly httpService: HttpService,
        private readonly throttle: TenantThrottleService,
    ) {}

    // ── Lazy table creation ───────────────────────────────────────────

    private async ensureTable(): Promise<void> {
        const cacheKey = 'hook_tables_ok';
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        await this.prisma.$queryRawUnsafe(
            `CREATE TABLE IF NOT EXISTS public.webhook_subscriptions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL REFERENCES public.tenants(id),
                target_url TEXT NOT NULL,
                event TEXT NOT NULL,
                secret TEXT NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                last_triggered_at TIMESTAMPTZ
            )`,
        );

        await this.prisma.$queryRawUnsafe(
            `CREATE INDEX IF NOT EXISTS idx_webhook_subs_tenant_event
             ON public.webhook_subscriptions (tenant_id, event)
             WHERE is_active = true`,
        );

        await this.redis.set(cacheKey, '1', 86400); // 24h
    }

    // ── SSRF validation ───────────────────────────────────────────────

    private async validateTargetUrl(url: string): Promise<PinnedHttpsTarget> {
        return prepareSafeHttpsTarget(url, 'webhook publico');
    }

    // ── CRUD ──────────────────────────────────────────────────────────

    async subscribe(
        tenantId: string,
        targetUrl: string,
        event: string,
    ): Promise<WebhookSubscription> {
        const target = await this.validateTargetUrl(targetUrl);

        if (!ZAPIER_HOOK_EVENTS.includes(event as ZapierHookEvent)) {
            throw new BadRequestException(
                `Invalid event. Allowed: ${ZAPIER_HOOK_EVENTS.join(', ')}`,
            );
        }

        await this.ensureTable();

        // Plan gate: cap active webhook subscriptions per the tenant's plan
        // (emprendedor/starter=0, pro=10, enterprise/custom=-1 unlimited).
        const countRows = await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS c FROM public.webhook_subscriptions WHERE tenant_id = $1::uuid AND is_active = true`,
            tenantId,
        ) as any[];
        await this.throttle.enforcePlanLimit(tenantId, 'maxWebhookSubscriptions', countRows?.[0]?.c || 0, 'suscripciones de webhook');

        const secret = crypto.randomBytes(32).toString('hex');

        const rows = await this.prisma.$queryRawUnsafe(
            `INSERT INTO public.webhook_subscriptions (tenant_id, target_url, event, secret)
             VALUES ($1::uuid, $2, $3, $4)
             RETURNING id, tenant_id, target_url, event, secret, is_active, created_at, last_triggered_at`,
            tenantId,
            target.url.toString(),
            event,
            secret,
        ) as any[];

        return rows[0];
    }

    async unsubscribe(tenantId: string, hookId: string): Promise<void> {
        await this.ensureTable();

        const rows = await this.prisma.$queryRawUnsafe(
            `DELETE FROM public.webhook_subscriptions
             WHERE id = $1::uuid AND tenant_id = $2::uuid
             RETURNING id`,
            hookId,
            tenantId,
        ) as any[];

        if (!rows || rows.length === 0) {
            throw new BadRequestException('Webhook subscription not found');
        }
    }

    async listHooks(tenantId: string): Promise<WebhookSubscription[]> {
        await this.ensureTable();

        return this.prisma.$queryRawUnsafe(
            `SELECT id, tenant_id, target_url, event, is_active, created_at, last_triggered_at
             FROM public.webhook_subscriptions
             WHERE tenant_id = $1::uuid AND is_active = true
             ORDER BY created_at DESC`,
            tenantId,
        ) as any;
    }

    // ── Dispatch (fire-and-forget) ────────────────────────────────────

    async dispatchEvent(
        tenantId: string,
        event: string,
        payload: Record<string, any>,
    ): Promise<void> {
        await this.ensureTable();

        const subs = await this.prisma.$queryRawUnsafe(
            `SELECT id, target_url, secret
             FROM public.webhook_subscriptions
             WHERE tenant_id = $1::uuid AND event = $2 AND is_active = true`,
            tenantId,
            event,
        ) as any[];

        if (!subs || subs.length === 0) return;

        for (const sub of subs) {
            this.deliver(sub, event, payload).catch((err) =>
                this.logger.error(
                    `Zapier hook delivery failed: hook=${sub.id} event=${event} error=${err.message}`,
                ),
            );
        }
    }

    private async deliver(
        sub: Pick<WebhookSubscription, 'id' | 'target_url' | 'secret'>,
        event: string,
        payload: Record<string, any>,
    ): Promise<void> {
        // Defense-in-depth: validate URL at delivery time
        let target: PinnedHttpsTarget;
        try {
            target = await this.validateTargetUrl(sub.target_url);
        } catch {
            this.logger.warn(
                `Skipping hook delivery to blocked URL: hook=${sub.id} url=${sub.target_url.substring(0, 80)}`,
            );
            return;
        }

        const body = JSON.stringify(payload);
        const signature = crypto
            .createHmac('sha256', sub.secret)
            .update(body)
            .digest('hex');

        try {
            await this.httpService.axiosRef.post(target.url.toString(), body, {
                ...safeAxiosOptions(target, 10_000),
                headers: {
                    'Content-Type': 'application/json',
                    'X-Hook-Signature': signature,
                    'X-Hook-Event': event,
                },
                validateStatus: () => true,
            });

            // Update last_triggered_at (fire-and-forget)
            this.prisma
                .$queryRawUnsafe(
                    `UPDATE public.webhook_subscriptions SET last_triggered_at = NOW() WHERE id = $1::uuid`,
                    sub.id,
                )
                .catch(() => {});
        } catch (err: any) {
            this.logger.warn(
                `Hook delivery error: hook=${sub.id} event=${event} error=${err.message}`,
            );
        }
    }
}
