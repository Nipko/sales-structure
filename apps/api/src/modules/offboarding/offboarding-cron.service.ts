import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { OffboardingService } from './offboarding.service';

@Injectable()
export class OffboardingCronService {
    private readonly logger = new Logger(OffboardingCronService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private offboardingService: OffboardingService,
    ) {}

    /**
     * Runs at 3 AM daily — enforces grace period for past_due and
     * cancels tenants whose billing period has ended.
     */
    @Cron('0 3 * * *')
    async graceEnforcer(): Promise<void> {
        this.logger.log('Running grace period enforcer...');

        // 1. Past-due tenants: offboard if past_due > 7 days
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
                    const pastDueSince = await this.redis.get(`offboard:past_due:${tenant.id}`);
                    if (!pastDueSince) {
                        // No record of when past_due started — set it now
                        await this.redis.set(
                            `offboard:past_due:${tenant.id}`,
                            new Date().toISOString(),
                            30 * 24 * 60 * 60, // 30 days TTL
                        );
                        continue;
                    }

                    const daysSincePastDue = (Date.now() - new Date(pastDueSince).getTime()) / (1000 * 60 * 60 * 24);
                    if (daysSincePastDue > 7) {
                        this.logger.log(`Tenant ${tenant.id} (${tenant.name}) has been past_due for ${Math.floor(daysSincePastDue)} days — offboarding`);
                        await this.offboardingService.executeOffboarding(tenant.id, 'grace_period_expired');
                        await this.redis.del(`offboard:past_due:${tenant.id}`);
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
    @Cron('0 4 * * *')
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
                    // Sanitize schema name to prevent SQL injection
                    const schemaName = tenant.schemaName.replace(/[^a-zA-Z0-9_]/g, '');
                    if (!schemaName || schemaName !== tenant.schemaName) {
                        this.logger.warn(`Skipping tenant ${tenant.id}: suspicious schema name "${tenant.schemaName}"`);
                        continue;
                    }

                    await this.prisma.$queryRawUnsafe(
                        `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
                    );

                    this.logger.log(`Dropped schema "${schemaName}" for inactive tenant ${tenant.id} (${tenant.name})`);

                    // Audit log
                    await this.prisma.auditLog.create({
                        data: {
                            tenantId: tenant.id,
                            action: 'schema_dropped',
                            resource: 'offboarding',
                            details: { schemaName, reason: 'inactive_90_days' },
                        },
                    });
                } catch (error) {
                    this.logger.error(`Failed to drop schema for tenant ${tenant.id}: ${error}`);
                }
            }

            if (staleInactiveTenants.length > 0) {
                this.logger.log(`Archive cleaner processed ${staleInactiveTenants.length} stale tenants`);
            }
        } catch (error) {
            this.logger.error(`Archive cleaner failed: ${error}`);
        }
    }

    // ── Billing event listeners ──────────────────────────────────

    @OnEvent('billing.payment.failed')
    async onPaymentFailed(payload: { tenantId: string }): Promise<void> {
        const { tenantId } = payload;
        if (!tenantId) return;

        const key = `offboard:past_due:${tenantId}`;
        const existing = await this.redis.get(key);
        if (!existing) {
            await this.redis.set(key, new Date().toISOString(), 30 * 24 * 60 * 60);
            this.logger.log(`Payment failed for tenant ${tenantId} — past_due timer started`);
        }
    }

    @OnEvent('billing.payment.succeeded')
    async onPaymentSucceeded(payload: { tenantId: string }): Promise<void> {
        const { tenantId } = payload;
        if (!tenantId) return;

        const key = `offboard:past_due:${tenantId}`;
        await this.redis.del(key);
        this.logger.log(`Payment succeeded for tenant ${tenantId} — past_due timer cleared`);
    }
}
