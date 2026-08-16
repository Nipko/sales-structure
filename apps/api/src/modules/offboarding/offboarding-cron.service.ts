import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OffboardingService } from './offboarding.service';
import { BillingEventType } from '../billing/types/billing-event.enum';
import { CronLockService } from '../redis/cron-lock.service';
import {
    DUNNING_EXPIRY_DAY,
    DUNNING_SOFT_LOCK_DAY,
    DunningService,
} from '../billing/recurring/dunning.service';

const PAST_DUE_MIRROR_TTL_SECONDS = 30 * 24 * 60 * 60;

@Injectable()
export class OffboardingCronService {
    private readonly logger = new Logger(OffboardingCronService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private offboardingService: OffboardingService,
        private eventEmitter: EventEmitter2,
        private readonly cronLock: CronLockService,
        private readonly dunning: DunningService,
    ) {}

    /**
     * Runs every 30 min — detects trials that have expired and transitions
     * them to past_due, starting the durable 10-day recovery countdown.
     */
    @Cron('*/30 * * * *')
    async trialExpiryDetector(): Promise<void> {
        try {
            const expired = await this.prisma.billingSubscription.findMany({
                where: {
                    status: 'trialing',
                    trialEndsAt: { lt: new Date() },
                },
                select: { id: true, tenantId: true, trialEndsAt: true },
            });
            if (expired.length === 0) return;
            this.logger.log(`[TrialExpiry] Found ${expired.length} expired trial(s)`);

            for (const sub of expired) {
                try {
                    // The contractual trial end is the recovery-clock anchor,
                    // not whichever API instance happens to run this cron.
                    // Redis mirrors it for backwards compatibility, but the DB
                    // remains authoritative across cache flushes and outages.
                    const dunningStartedAt = sub.trialEndsAt ?? new Date();
                    const transitioned = await this.prisma.$transaction(async (tx: any) => {
                        const updated = await tx.billingSubscription.updateMany({
                            where: {
                                id: sub.id,
                                status: 'trialing',
                                trialEndsAt: sub.trialEndsAt,
                            },
                            data: {
                                status: 'past_due',
                                dunningState: 'grace',
                                dunningStartedAt,
                            },
                        });
                        if (updated.count !== 1) return false;
                        await tx.tenant.update({
                            where: { id: sub.tenantId },
                            data: { subscriptionStatus: 'past_due' },
                        });
                        return true;
                    });
                    if (!transitioned) continue;
                    await this.invalidateEntitlementCaches(sub.tenantId);
                    await this.mirrorPastDueStartedAt(sub.tenantId, dunningStartedAt);

                    // Dedup via billing_events UNIQUE(provider, providerEventId) —
                    // prevents duplicate emails when multiple API instances run this cron.
                    const providerEventId = `synthetic_trial_ended_${sub.id}`;
                    try {
                        await this.prisma.billingEvent.create({
                            data: {
                                tenantId: sub.tenantId,
                                subscriptionId: sub.id,
                                provider: 'system',
                                providerEventId,
                                eventType: BillingEventType.TRIAL_ENDED,
                                payload: { trialEndsAt: sub.trialEndsAt, source: 'cron_trial_expiry' } as any,
                            },
                        });
                    } catch {
                        this.logger.debug(`[TrialExpiry] Tenant ${sub.tenantId} TRIAL_ENDED already emitted — skipping`);
                        continue;
                    }

                    this.eventEmitter.emit(BillingEventType.TRIAL_ENDED, {
                        tenantId: sub.tenantId,
                        subscriptionId: sub.id,
                    });
                    this.logger.log(`[TrialExpiry] Tenant ${sub.tenantId} trial expired → past_due (10d recovery)`);
                } catch (error) {
                    this.logger.error(`[TrialExpiry] Failed for tenant ${sub.tenantId}: ${error}`);
                }
            }
        } catch (error) {
            this.logger.error(`[TrialExpiry] Detector failed: ${error}`);
        }
    }

    /**
     * Runs at 3 AM daily — enforces grace period for past_due and
     * cancels tenants whose billing period has ended.
     */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('0 3 * * *')
    async graceEnforcerCron() {
        await this.cronLock.runExclusive('offboarding-cron.graceEnforcer', 3600, () => this.graceEnforcer());
    }

    async graceEnforcer(): Promise<void> {
        this.logger.log('Running grace period enforcer...');

        // 1. Past-due tenants: transition to expired after day 10, soft-lock at day 3.
        // DunningService uses the same ladder; this cron is the durable safety net.
        try {
            const pastDueTenants = await this.prisma.tenant.findMany({
                where: {
                    subscriptionStatus: 'past_due',
                    isActive: true,
                },
                select: { id: true, name: true },
            });

            for (const tenant of pastDueTenants) {
                try {
                    // Never cut off a tenant whose charge is still in play. With
                    // the internal engine a renewal can be queued, in flight, or
                    // waiting on an asynchronous provider — and an unresolved
                    // charge may already have taken the money. Expiring here
                    // would revoke access to someone who just paid.
                    const subscription = await this.prisma.billingSubscription.findUnique({
                        where: { tenantId: tenant.id },
                        select: {
                            id: true,
                            engine: true,
                            dunningStartedAt: true,
                            dunningState: true,
                            cancellationReason: true,
                        },
                    });
                    if (!subscription) {
                        this.logger.error(
                            `[GraceEnforcer] Tenant ${tenant.id} is past_due without a billing subscription; refusing to infer an expiry clock`,
                        );
                        continue;
                    }
                    if (String(subscription.cancellationReason ?? '').startsWith('paused')) {
                        this.logger.debug(
                            `[GraceEnforcer] Tenant ${tenant.id} is voluntarily paused; skipping dunning expiry`,
                        );
                        continue;
                    }

                    let pastDueStartedAt = subscription.dunningStartedAt;
                    if (!pastDueStartedAt) {
                        // One-time bridge for rows created before the durable
                        // clock existed. If Redis is also missing/unavailable,
                        // start a fresh recovery window rather than guess and
                        // revoke access prematurely.
                        const legacyValue = await this.redis.get(`offboard:past_due:${tenant.id}`)
                            .catch((error: any) => {
                                this.logger.warn(
                                    `[GraceEnforcer] Could not read legacy timer for ${tenant.id}: ${error?.message ?? String(error)}`,
                                );
                                return null;
                            });
                        const parsedLegacy = legacyValue ? new Date(legacyValue) : null;
                        const hasValidLegacy = !!parsedLegacy && Number.isFinite(parsedLegacy.getTime());
                        pastDueStartedAt = hasValidLegacy ? parsedLegacy! : new Date();

                        const clockClaim = await this.prisma.billingSubscription.updateMany({
                            where: {
                                id: subscription.id,
                                status: 'past_due',
                                dunningStartedAt: null,
                                dunningState: subscription.dunningState,
                            },
                            data: {
                                dunningStartedAt: pastDueStartedAt,
                                ...(!subscription.dunningState || subscription.dunningState === 'none'
                                    ? { dunningState: 'grace' }
                                    : {}),
                            },
                        });
                        // A payment may have restored ACTIVE after the tenant
                        // scan. Never seed a new dunning clock over that commit.
                        if (clockClaim.count !== 1) continue;
                        await this.mirrorPastDueStartedAt(tenant.id, pastDueStartedAt);
                        if (!hasValidLegacy) continue;
                    }

                    const daysSincePastDue = Math.max(
                        0,
                        (Date.now() - pastDueStartedAt.getTime()) / 86_400_000,
                    );

                    if (subscription?.engine === 'internal'
                        && await this.dunning.hasLiveAttempt(subscription.id)) {
                        this.logger.log(
                            `Tenant ${tenant.id} past_due ${Math.floor(daysSincePastDue)}d but a charge is still in play — not expiring`,
                        );
                        continue;
                    }

                    if (daysSincePastDue >= DUNNING_EXPIRY_DAY) {
                        this.logger.log(`Tenant ${tenant.id} (${tenant.name}) past_due ${Math.floor(daysSincePastDue)}d → expired`);
                        const transitioned = await this.prisma.$transaction(async (tx: any) => {
                            const updated = await tx.billingSubscription.updateMany({
                                where: {
                                    id: subscription.id,
                                    tenantId: tenant.id,
                                    status: 'past_due',
                                    dunningStartedAt: pastDueStartedAt,
                                },
                                data: { status: 'expired', dunningState: 'suspended' },
                            });
                            if (updated.count !== 1) return false;
                            await tx.tenant.update({
                                where: { id: tenant.id },
                                data: { subscriptionStatus: 'expired' },
                            });
                            return true;
                        });
                        if (!transitioned) continue;
                        await this.invalidateEntitlementCaches(tenant.id, [`offboard:past_due:${tenant.id}`]);

                        const expiredEventId = `synthetic_subscription_expired_${tenant.id}`;
                        try {
                            await this.prisma.billingEvent.create({
                                data: {
                                    tenantId: tenant.id,
                                    provider: 'system',
                                    providerEventId: expiredEventId,
                                    eventType: BillingEventType.SUBSCRIPTION_EXPIRED,
                                    payload: { daysSincePastDue: Math.floor(daysSincePastDue), source: 'cron_grace_enforcer' } as any,
                                },
                            });
                        } catch {
                            this.logger.debug(`[GraceEnforcer] Tenant ${tenant.id} SUBSCRIPTION_EXPIRED already emitted — skipping`);
                            continue;
                        }

                        this.eventEmitter.emit(BillingEventType.SUBSCRIPTION_EXPIRED, {
                            tenantId: tenant.id,
                        });
                    } else if (daysSincePastDue >= DUNNING_SOFT_LOCK_DAY) {
                        const softLockKey = `billing:soft_lock_notified:${tenant.id}`;
                        const alreadyNotified = await this.redis.get(softLockKey).catch(() => null);
                        if (!alreadyNotified) {
                            this.eventEmitter.emit('billing.subscription.soft_locked', {
                                tenantId: tenant.id,
                                daysRemaining: Math.max(0, DUNNING_EXPIRY_DAY - Math.floor(daysSincePastDue)),
                            });
                            await this.redis.set(
                                softLockKey,
                                '1',
                                DUNNING_EXPIRY_DAY * 24 * 60 * 60,
                            ).catch(() => undefined);
                        }
                    }
                } catch (error) {
                    this.logger.error(`Failed to process past_due tenant ${tenant.id}: ${error}`);
                }
            }
        } catch (error) {
            this.logger.error(`Grace enforcer (past_due) failed: ${error}`);
        }

        // 2. Cancelled tenants: offboard if period has ended
        try {
            // Time-boxed comp/gift plans have no provider and no next charge,
            // therefore no webhook can end them. Expire the entitlement at the
            // promised boundary instead of leaving a permanent free account.
            const expiredComps = await this.prisma.billingSubscription.findMany({
                where: {
                    status: 'active',
                    cancellationReason: { startsWith: 'comp:' },
                    currentPeriodEnd: { lt: new Date() },
                },
                select: {
                    id: true,
                    tenantId: true,
                    status: true,
                    cancellationReason: true,
                    currentPeriodEnd: true,
                },
                take: 500,
            });
            for (const sub of expiredComps) {
                const transitioned = await this.prisma.$transaction(async (tx: any) => {
                    const updated = await tx.billingSubscription.updateMany({
                        where: {
                            id: sub.id,
                            tenantId: sub.tenantId,
                            status: sub.status,
                            cancellationReason: sub.cancellationReason,
                            currentPeriodEnd: sub.currentPeriodEnd,
                        },
                        data: { status: 'expired', nextChargeAt: null },
                    });
                    if (updated.count !== 1) return false;
                    await tx.tenant.update({
                        where: { id: sub.tenantId },
                        data: { subscriptionStatus: 'expired' },
                    });
                    return true;
                });
                if (!transitioned) continue;
                await this.redis.del(`sub_status:${sub.tenantId}`);
                await this.redis.del(`tenant_plan:${sub.tenantId}`);
            }

            // Internal-engine cancellations deliberately stay ACTIVE while the
            // already-paid period is usable. There is no provider webhook to
            // flip them at the boundary, so materialize that transition here
            // before the existing offboarding query.
            const endedScheduled = await this.prisma.billingSubscription.findMany({
                where: {
                    cancelAtPeriodEnd: true,
                    currentPeriodEnd: { lt: new Date() },
                    status: { notIn: ['cancelled', 'expired'] },
                },
                select: {
                    id: true,
                    tenantId: true,
                    status: true,
                    cancelAtPeriodEnd: true,
                    currentPeriodEnd: true,
                },
                take: 500,
            });
            for (const sub of endedScheduled) {
                const transitioned = await this.prisma.$transaction(async (tx: any) => {
                    const updated = await tx.billingSubscription.updateMany({
                        where: {
                            id: sub.id,
                            tenantId: sub.tenantId,
                            status: sub.status,
                            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
                            currentPeriodEnd: sub.currentPeriodEnd,
                        },
                        data: {
                            status: 'cancelled',
                            cancelledAt: new Date(),
                            nextChargeAt: null,
                        },
                    });
                    if (updated.count !== 1) return false;
                    await tx.tenant.update({
                        where: { id: sub.tenantId },
                        data: { subscriptionStatus: 'cancelled' },
                    });
                    return true;
                });
                if (!transitioned) continue;
                await this.redis.del(`sub_status:${sub.tenantId}`);
                await this.redis.del(`tenant_plan:${sub.tenantId}`);
            }

            const cancelledTenants = await this.prisma.tenant.findMany({
                where: {
                    subscriptionStatus: 'cancelled',
                    isActive: true,
                    currentPeriodEnd: { lt: new Date() },
                },
                select: { id: true, name: true },
            });

            for (const tenant of cancelledTenants) {
                try {
                    this.logger.log(`Tenant ${tenant.id} (${tenant.name}) cancelled and period ended — offboarding`);
                    await this.offboardingService.executeOffboarding(tenant.id, 'voluntary');
                } catch (error) {
                    this.logger.error(`Failed to offboard cancelled tenant ${tenant.id}: ${error}`);
                }
            }

            if (cancelledTenants.length > 0) {
                this.logger.log(`Grace enforcer processed ${cancelledTenants.length} cancelled tenants`);
            }
        } catch (error) {
            this.logger.error(`Grace enforcer (cancelled) failed: ${error}`);
        }
    }

    /**
     * Runs at 4 AM daily — drops schemas of tenants inactive for 90+ days.
     */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('0 4 * * *')
    async archiveCleanerCron() {
        await this.cronLock.runExclusive('offboarding-cron.archiveCleaner', 3600, () => this.archiveCleaner());
    }

    async archiveCleaner(): Promise<void> {
        this.logger.log('Running archive cleaner...');

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);

        try {
            const staleInactiveTenants = await this.prisma.tenant.findMany({
                where: {
                    isActive: false,
                    updatedAt: { lt: cutoff },
                },
                select: { id: true, name: true, schemaName: true },
            });

            for (const tenant of staleInactiveTenants) {
                try {
                    // The retention expiry uses the same fenced, verified and
                    // atomic purge saga as an explicit admin purge.  A direct
                    // DROP here used to lose OAuth credentials before they
                    // could be revoked and left partially deleted global rows.
                    await this.offboardingService.purgeTenant(tenant.id);
                    this.logger.log(`Purged inactive tenant ${tenant.id} (${tenant.name}) after 90-day retention`);
                } catch (error) {
                    this.logger.error(`Failed to purge inactive tenant ${tenant.id}: ${error}`);
                }
            }

            if (staleInactiveTenants.length > 0) {
                this.logger.log(`Archive cleaner processed ${staleInactiveTenants.length} stale tenants`);
            }
        } catch (error) {
            this.logger.error(`Archive cleaner failed: ${error}`);
        }
    }

    /**
     * Runs at 5 AM daily — purges channel_accounts that have been inactive
     * for more than 90 days. The row is kept that long so support requests
     * and "reactivate channel" use cases still work; after that it's pure
     * dead weight (HubSpot / Slack pattern).
     *
     * audit_logs row stays — that table is the historical truth and we
     * don't sweep it as part of this job.
     */
    @Cron('0 5 * * *')
    async purgeStaleInactiveChannels(): Promise<void> {
        this.logger.log('Running stale-channel purge...');

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffIso = cutoff.toISOString();

        try {
            // Match on metadata.disconnected_at (set by every disconnect path
            // we own) — falls back to updated_at for legacy rows that pre-date
            // the metadata stamp.
            const result = (await this.prisma.$queryRawUnsafe(
                `DELETE FROM channel_accounts
                 WHERE is_active = false
                   AND COALESCE(
                       (metadata->>'disconnected_at')::timestamp,
                       updated_at
                   ) < $1::timestamp
                 RETURNING id, tenant_id, channel_type, account_id`,
                cutoffIso,
            )) as any[];

            const purged = result?.length || 0;
            if (purged > 0) {
                this.logger.log(`Purged ${purged} stale channel_account row(s) (>90d inactive)`);

                // One audit row per purge run summarises the batch — saves
                // writing 1 audit row per purged channel
                try {
                    await this.prisma.auditLog.create({
                        data: {
                            tenantId: null,
                            action: 'stale_channels_purged',
                            resource: 'channel_accounts',
                            details: {
                                purged,
                                cutoff: cutoffIso,
                                channels: result.map(r => ({
                                    tenantId: r.tenant_id,
                                    channelType: r.channel_type,
                                    accountId: r.account_id,
                                })),
                            },
                        },
                    });
                } catch (err: any) {
                    this.logger.warn(`Failed to write audit_log for stale-channel purge: ${err.message}`);
                }
            }
        } catch (error: any) {
            this.logger.error(`Stale-channel purge failed: ${error.message}`);
        }
    }

    // ── Billing event listeners ──────────────────────────────────

    @OnEvent('billing.payment.failed')
    async onPaymentFailed(payload: { tenantId: string }): Promise<void> {
        const { tenantId } = payload;
        if (!tenantId) return;

        const startedAt = new Date();
        await this.prisma.billingSubscription.updateMany({
            where: {
                tenantId,
                status: 'past_due',
                dunningStartedAt: null,
            },
            data: { dunningStartedAt: startedAt, dunningState: 'grace' },
        }).catch((error: any) => {
            this.logger.error(
                `Payment failed for tenant ${tenantId}, but durable dunning clock could not be started: ${error?.message ?? String(error)}`,
            );
        });

        const key = `offboard:past_due:${tenantId}`;
        const existing = await this.redis.get(key).catch(() => null);
        if (!existing) {
            await this.redis.set(key, startedAt.toISOString(), PAST_DUE_MIRROR_TTL_SECONDS)
                .catch(() => undefined);
            this.logger.log(`Payment failed for tenant ${tenantId} — past_due timer started`);
        }
    }

    @OnEvent('billing.payment.succeeded')
    async onPaymentSucceeded(payload: { tenantId: string }): Promise<void> {
        const { tenantId } = payload;
        if (!tenantId) return;

        await this.redis.del(`offboard:past_due:${tenantId}`);
        await this.redis.del(`billing:soft_lock_notified:${tenantId}`);
        await this.redis.del(`sub_status:${tenantId}`);
        await this.redis.del(`tenant_plan:${tenantId}`);
        this.logger.log(`Payment succeeded for tenant ${tenantId} — grace timers cleared, access restored`);
    }

    private async mirrorPastDueStartedAt(tenantId: string, startedAt: Date): Promise<void> {
        await this.redis.set(
            `offboard:past_due:${tenantId}`,
            startedAt.toISOString(),
            PAST_DUE_MIRROR_TTL_SECONDS,
        ).catch((error: any) => {
            this.logger.warn(
                `[Billing] Could not mirror durable dunning clock for ${tenantId}: ${error?.message ?? String(error)}`,
            );
        });
    }

    private async invalidateEntitlementCaches(tenantId: string, extraKeys: string[] = []): Promise<void> {
        const keys = [
            `sub_status:${tenantId}`,
            `tenant_plan:${tenantId}`,
            `plan_features:${tenantId}`,
            ...extraKeys,
        ];
        await Promise.all(keys.map(async (key) => {
            try {
                await this.redis.del(key);
            } catch (error: any) {
                this.logger.warn(
                    `[Billing] Could not invalidate ${key}: ${error?.message ?? String(error)}`,
                );
            }
        }));
    }
}
