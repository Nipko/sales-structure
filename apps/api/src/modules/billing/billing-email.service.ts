import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { BillingEventType } from './types/billing-event.enum';
import {
    trialEndingSoonEmail,
    trialEndedEmail,
    paymentFailedEmail,
    softLockEmail,
    accountSuspendedEmail,
    paymentSucceededEmail,
} from '../email/email-layouts';
import { emsg } from '../email/email-i18n';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SOFT_LOCKED = 'billing.subscription.soft_locked';
const EMAIL_EVENT_TYPES = Object.freeze([
    BillingEventType.TRIAL_ENDING_SOON,
    BillingEventType.TRIAL_ENDED,
    BillingEventType.PAYMENT_FAILED,
    SOFT_LOCKED,
    BillingEventType.SUBSCRIPTION_EXPIRED,
    BillingEventType.PAYMENT_SUCCEEDED,
]);

/** Admit billing lifecycle mail into the durable platform outbox. */
@Injectable()
export class BillingEmailService {
    private readonly logger = new Logger(BillingEmailService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cronLock: CronLockService,
    ) {}

    @OnEvent(BillingEventType.TRIAL_ENDING_SOON)
    onTrialEndingSoon(payload: any) { return this.admit(BillingEventType.TRIAL_ENDING_SOON, payload); }

    @OnEvent(BillingEventType.TRIAL_ENDED)
    onTrialEnded(payload: any) { return this.admit(BillingEventType.TRIAL_ENDED, payload); }

    @OnEvent(BillingEventType.PAYMENT_FAILED)
    onPaymentFailed(payload: any) { return this.admit(BillingEventType.PAYMENT_FAILED, payload); }

    @OnEvent(SOFT_LOCKED)
    onSoftLocked(payload: any) { return this.admit(SOFT_LOCKED, payload); }

    @OnEvent(BillingEventType.SUBSCRIPTION_EXPIRED)
    onExpired(payload: any) { return this.admit(BillingEventType.SUBSCRIPTION_EXPIRED, payload); }

    @OnEvent(BillingEventType.PAYMENT_SUCCEEDED)
    onPaymentSucceeded(payload: any) { return this.admit(BillingEventType.PAYMENT_SUCCEEDED, payload); }

    @Cron('17 * * * * *')
    async recoverCron(): Promise<void> {
        await this.cronLock.runExclusive('billing.notifications.admit', 40,
            () => this.recoverPending(), { prefer: 'worker' });
    }

    async recoverPending(limit = 100): Promise<number> {
        const bounded = Math.min(Math.max(Number(limit) || 1, 1), 100);
        const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id
            FROM billing_events
            WHERE notification_outbox_created_at IS NULL
              AND event_type=ANY($1::text[])
            ORDER BY processed_at,id LIMIT ${bounded}`, [...EMAIL_EVENT_TYPES]);
        for (const row of rows) {
            try { await this.enqueueEvent(row.id); }
            catch (error: any) {
                this.logger.warn(`[BillingEmail] Could not admit ${row.id}: ${error?.message ?? String(error)}`);
            }
        }
        return rows.length;
    }

    async enqueueEvent(eventId: string): Promise<'enqueued' | 'already_admitted' | 'recipient_missing'> {
        if (!UUID.test(eventId)) throw new Error('billing_notification_invalid_event');
        return this.prisma.$transaction(async (tx: any) => {
            const [event] = await tx.$queryRawUnsafe(`SELECT id,tenant_id,subscription_id,event_type,payload,
                    notification_outbox_created_at
                FROM billing_events WHERE id=$1::uuid FOR UPDATE`, eventId);
            if (!event) throw new Error('billing_notification_event_not_found');
            if (event.notification_outbox_created_at) return 'already_admitted';
            if (!EMAIL_EVENT_TYPES.includes(event.event_type)) throw new Error('billing_notification_event_unsupported');

            const ctx = await this.resolveContext(tx, event.tenant_id, event.subscription_id);
            if (!ctx) {
                await tx.$executeRawUnsafe(`UPDATE billing_events
                    SET notification_outbox_created_at=NOW() WHERE id=$1::uuid`, eventId);
                this.logger.warn(`[BillingEmail] Event ${eventId} has no active billing recipient`);
                return 'recipient_missing';
            }
            const message = await this.render(tx, event, ctx);
            await tx.$executeRawUnsafe(`INSERT INTO platform_notification_outbox(
                    event_key,kind,entity_id,tenant_id,recipient_email,payload)
                VALUES($1,'billing.lifecycle_email',$2::uuid,$3::uuid,$4,$5::jsonb)
                ON CONFLICT(event_key) DO NOTHING`,
            `billing:${event.id}`, event.id, event.tenant_id, ctx.email,
            JSON.stringify({ subject: message.subject, html: message.html, eventType: event.event_type }));
            await tx.$executeRawUnsafe(`UPDATE billing_events
                SET notification_outbox_created_at=NOW() WHERE id=$1::uuid`, eventId);
            return 'enqueued';
        });
    }

    private async admit(type: string, payload: any): Promise<void> {
        try {
            const id = await this.findEventId(type, payload);
            if (!id) {
                this.logger.warn(`[BillingEmail] No canonical event found for ${type}`);
                return;
            }
            await this.enqueueEvent(id);
        } catch (error: any) {
            // Recovery owns eventual admission; mail must not reinterpret a
            // financial transition or make a provider webhook retry.
            this.logger.warn(`[BillingEmail] Admission failed for ${type}: ${error?.message ?? String(error)}`);
        }
    }

    private async findEventId(type: string, payload: any): Promise<string | null> {
        if (UUID.test(String(payload?.billingEventId ?? ''))) return payload.billingEventId;
        const provider = payload?.event?.provider;
        const providerEventId = payload?.event?.providerEventId;
        if (provider && providerEventId) {
            const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id
                FROM billing_events WHERE provider=$1 AND provider_event_id=$2 LIMIT 1`,
            String(provider), String(providerEventId));
            return rows[0]?.id ?? null;
        }
        if (!UUID.test(String(payload?.tenantId ?? ''))) return null;
        const params: unknown[] = [type, payload.tenantId];
        let subscription = '';
        if (UUID.test(String(payload?.subscriptionId ?? ''))) {
            params.push(payload.subscriptionId);
            subscription = ` AND subscription_id=$${params.length}::uuid`;
        }
        const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id
            FROM billing_events
            WHERE event_type=$1 AND tenant_id=$2::uuid${subscription}
              AND notification_outbox_created_at IS NULL
            ORDER BY processed_at DESC,id DESC LIMIT 1`, ...params);
        return rows[0]?.id ?? null;
    }

    private async resolveContext(tx: any, tenantId?: string, subscriptionId?: string): Promise<{
        email: string; firstName: string; planName: string; lang: string;
    } | null> {
        if (!UUID.test(String(tenantId ?? ''))) return null;
        const [tenants, users, subscriptions] = await Promise.all([
            tx.$queryRawUnsafe(`SELECT billing_email,name,language FROM tenants WHERE id=$1::uuid`, tenantId),
            tx.$queryRawUnsafe(`SELECT email,first_name,role FROM users
                WHERE tenant_id=$1::uuid AND is_active=true AND email IS NOT NULL
                ORDER BY CASE WHEN role='tenant_admin' THEN 0 ELSE 1 END,id LIMIT 10`, tenantId),
            subscriptionId
                ? tx.$queryRawUnsafe(`SELECT p.name AS plan_name FROM billing_subscriptions s
                    JOIN billing_plans p ON p.id=s.plan_id WHERE s.id=$1::uuid`, subscriptionId)
                : tx.$queryRawUnsafe(`SELECT p.name AS plan_name FROM billing_subscriptions s
                    JOIN billing_plans p ON p.id=s.plan_id WHERE s.tenant_id=$1::uuid`, tenantId),
        ]);
        const tenant = tenants[0];
        if (!tenant) return null;
        const admin = users[0];
        const email = String(tenant.billing_email ?? admin?.email ?? '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
        return {
            email,
            firstName: admin?.first_name || tenant.name,
            planName: subscriptions[0]?.plan_name || 'Parallly',
            lang: tenant.language || 'es',
        };
    }

    private async render(tx: any, event: any, ctx: any): Promise<{ subject: string; html: string }> {
        switch (event.event_type) {
            case BillingEventType.TRIAL_ENDING_SOON: {
                const end = event.payload?.trialEndsAt ? new Date(event.payload.trialEndsAt) : null;
                const days = end && Number.isFinite(end.getTime())
                    ? Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000)) : 3;
                return { subject: emsg(ctx.lang, 'trial.endingSubject'), html: trialEndingSoonEmail(ctx.firstName, days, ctx.planName, ctx.lang) };
            }
            case BillingEventType.TRIAL_ENDED:
                return { subject: emsg(ctx.lang, 'trialEnded.subject'), html: trialEndedEmail(ctx.firstName, ctx.planName, ctx.lang) };
            case BillingEventType.PAYMENT_FAILED:
                return { subject: emsg(ctx.lang, 'paymentFailed.subject'), html: paymentFailedEmail(ctx.firstName, ctx.planName, ctx.lang) };
            case SOFT_LOCKED: {
                const days = Math.max(0, Number(event.payload?.daysRemaining) || 0);
                return { subject: emsg(ctx.lang, 'softLock.subject'), html: softLockEmail(ctx.firstName, days, ctx.lang) };
            }
            case BillingEventType.SUBSCRIPTION_EXPIRED:
                return { subject: emsg(ctx.lang, 'suspended.subject'), html: accountSuspendedEmail(ctx.firstName, ctx.lang) };
            case BillingEventType.PAYMENT_SUCCEEDED: {
                const [payment] = await tx.$queryRawUnsafe(`SELECT amount_cents,currency FROM billing_payments
                    WHERE tenant_id=$1::uuid AND status='succeeded' ORDER BY created_at DESC,id DESC LIMIT 1`,
                event.tenant_id);
                const amount = payment ? `${(Number(payment.amount_cents) / 100).toFixed(2)} ${payment.currency}` : '';
                return { subject: emsg(ctx.lang, 'paymentOk.subject'), html: paymentSucceededEmail(ctx.firstName, ctx.planName, amount, ctx.lang) };
            }
            default:
                throw new Error('billing_notification_event_unsupported');
        }
    }
}
