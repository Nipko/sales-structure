import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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
        const cacheKey = 'hook_tables_ok_v2';
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

        await this.prisma.$queryRawUnsafe(
            `CREATE TABLE IF NOT EXISTS public.webhook_delivery_outbox (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                subscription_id UUID NOT NULL
                    REFERENCES public.webhook_subscriptions(id) ON DELETE CASCADE,
                tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
                event TEXT NOT NULL,
                event_key TEXT NOT NULL,
                payload JSONB NOT NULL,
                state TEXT NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending','in_flight','accepted','rejected','unknown')),
                attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
                lease_token UUID,
                lease_expires_at TIMESTAMPTZ,
                status_code INTEGER,
                error TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(subscription_id, event_key),
                CHECK ((state = 'in_flight') =
                    (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
            )`,
        );
        await this.prisma.$queryRawUnsafe(
            `CREATE INDEX IF NOT EXISTS idx_webhook_delivery_outbox_pending
                ON public.webhook_delivery_outbox(created_at)
                WHERE state = 'pending'`,
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
        eventKey?: string,
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

        const stableEventKey = String(eventKey ?? '').trim() || crypto.randomUUID();
        const rows = await Promise.all(subs.map(async (sub) => {
            const inserted = await this.prisma.$queryRawUnsafe(
                `INSERT INTO public.webhook_delivery_outbox
                    (subscription_id, tenant_id, event, event_key, payload)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
                 ON CONFLICT (subscription_id, event_key) DO UPDATE
                    SET updated_at = public.webhook_delivery_outbox.updated_at
                 RETURNING id, state`,
                sub.id,
                tenantId,
                event,
                stableEventKey,
                JSON.stringify(payload),
            ) as any[];
            return rowsFirst(inserted);
        }));

        await Promise.all(rows
            .filter((row): row is { id: string; state: string } => !!row && row.state === 'pending')
            .map((row) => this.deliverOutboxRow(row.id)));
    }

    /** Recover only work that never acquired permission to touch the network. */
    @Cron('23 * * * * *')
    async recoverPendingDeliveries(): Promise<void> {
        await this.ensureTable();
        await this.prisma.$queryRawUnsafe(
            `UPDATE public.webhook_delivery_outbox
                SET state = 'unknown', lease_token = NULL, lease_expires_at = NULL,
                    error = COALESCE(error, 'lease_expired_after_admission'), updated_at = NOW()
              WHERE state = 'in_flight' AND lease_expires_at <= NOW()`,
        );
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT id FROM public.webhook_delivery_outbox
              WHERE state = 'pending' ORDER BY created_at LIMIT 50`,
        ) as any[];
        await Promise.all((rows || []).map((row) => this.deliverOutboxRow(String(row.id))));
    }

    private async deliverOutboxRow(id: string): Promise<void> {
        const leaseToken = crypto.randomUUID();
        const claimed = await this.prisma.$queryRawUnsafe(
            `UPDATE public.webhook_delivery_outbox delivery
                SET state = 'in_flight', attempts = attempts + 1,
                    lease_token = $2::uuid, lease_expires_at = NOW() + INTERVAL '45 seconds',
                    updated_at = NOW()
              WHERE delivery.id = $1::uuid AND delivery.state = 'pending'
                AND EXISTS (
                    SELECT 1 FROM public.webhook_subscriptions subscription
                     WHERE subscription.id = delivery.subscription_id
                       AND subscription.is_active = true
                )
              RETURNING delivery.id, delivery.subscription_id, delivery.event, delivery.payload`,
            id,
            leaseToken,
        ) as any[];
        const row = rowsFirst(claimed);
        if (!row) return;

        const subscriptions = await this.prisma.$queryRawUnsafe(
            `SELECT id, target_url, secret FROM public.webhook_subscriptions
              WHERE id = $1::uuid AND is_active = true`,
            row.subscription_id,
        ) as any[];
        const sub = rowsFirst(subscriptions);
        const outcome = sub
            ? await this.deliver(sub, row.event, row.payload, String(row.id))
            : { outcome: 'rejected' as const, statusCode: null };

        if (outcome.outcome === 'accepted') {
            await this.prisma.$queryRawUnsafe(
                `WITH settled AS (
                    UPDATE public.webhook_delivery_outbox
                       SET state = 'accepted', status_code = $3, error = NULL,
                           lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
                     WHERE id = $1::uuid AND state = 'in_flight' AND lease_token = $2::uuid
                     RETURNING subscription_id
                 )
                 UPDATE public.webhook_subscriptions subscription
                    SET last_triggered_at = NOW()
                  FROM settled WHERE subscription.id = settled.subscription_id`,
                id,
                leaseToken,
                outcome.statusCode,
            );
            return;
        }
        await this.prisma.$queryRawUnsafe(
            `UPDATE public.webhook_delivery_outbox
                SET state = $3, status_code = $4, error = $5,
                    lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
              WHERE id = $1::uuid AND state = 'in_flight' AND lease_token = $2::uuid`,
            id,
            leaseToken,
            outcome.outcome,
            outcome.statusCode,
            outcome.outcome === 'unknown' ? 'provider_answer_missing' : 'provider_rejected',
        );
    }

    private async deliver(
        sub: Pick<WebhookSubscription, 'id' | 'target_url' | 'secret'>,
        event: string,
        payload: Record<string, any>,
        deliveryId: string = crypto.randomUUID(),
    ): Promise<{ outcome: 'accepted' | 'rejected' | 'unknown'; statusCode: number | null }> {
        // Defense-in-depth: validate URL at delivery time
        let target: PinnedHttpsTarget;
        try {
            target = await this.validateTargetUrl(sub.target_url);
        } catch {
            this.logger.warn(
                `Skipping hook delivery to blocked URL: hook=${sub.id} url=${sub.target_url.substring(0, 80)}`,
            );
            return { outcome: 'rejected', statusCode: null };
        }

        const body = JSON.stringify(payload);
        const signature = crypto
            .createHmac('sha256', sub.secret)
            .update(body)
            .digest('hex');

        try {
            const response = await this.httpService.axiosRef.post(target.url.toString(), body, {
                ...safeAxiosOptions(target, 10_000),
                headers: {
                    'Content-Type': 'application/json',
                    'X-Hook-Signature': signature,
                    'X-Hook-Event': event,
                    'X-Hook-Delivery': deliveryId,
                },
                validateStatus: () => true,
            });
            const statusCode = Number(response.status);
            if (statusCode < 200 || statusCode >= 300) {
                this.logger.warn(
                    `Hook rejected: hook=${sub.id} event=${event} status=${statusCode}`,
                );
                return { outcome: 'rejected', statusCode };
            }

            return { outcome: 'accepted', statusCode };
        } catch (err: any) {
            this.logger.warn(
                `Hook delivery error: hook=${sub.id} event=${event} error=${err.message}`,
            );
            return { outcome: 'unknown', statusCode: null };
        }
    }
}

function rowsFirst<T>(rows: T[] | undefined | null): T | undefined {
    return rows?.[0];
}
