import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { COMMERCIAL_PAYMENTS, COMMERCIAL_SUBSCRIPTIONS } from './commercial-scope.util';

@Injectable()
export class FinancialSnapshotService {
    private readonly logger = new Logger(FinancialSnapshotService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly llmRouter: LLMRouterService,
    ) {}

    /** Run on the 1st of every month at 1:00 AM — snapshot the previous month. */
    @Cron('0 1 1 * *')
    async generateMonthlySnapshot() {
        const now = new Date();
        const targetMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        this.logger.log(`Starting monthly financial snapshot for ${targetMonth.toISOString().slice(0, 7)}`);
        await this.generateSnapshot(targetMonth);
        this.logger.log(`Completed monthly financial snapshot for ${targetMonth.toISOString().slice(0, 7)}`);
    }

    async generateSnapshot(targetMonth: Date) {
        const monthEnd = new Date(
            targetMonth.getFullYear(),
            targetMonth.getMonth() + 1,
            0,
            23,
            59,
            59,
        );
        const monthStart = new Date(
            targetMonth.getFullYear(),
            targetMonth.getMonth(),
            1,
        );

        // Active subscriptions at end of month
        const activeSubs = await this.prisma.billingSubscription.findMany({
            where: { status: { in: ['active', 'trialing'] }, ...COMMERCIAL_SUBSCRIPTIONS },
            include: {
                plan: true,
                tenant: {
                    select: { id: true, name: true, createdAt: true, schemaName: true },
                },
            },
        });

        const mrrCents = activeSubs
            .filter((s: any) => s.status === 'active')
            .reduce((sum: number, s: any) => sum + (s.plan?.priceUsdCents || 0), 0);

        // Plan distribution
        const planDist: Record<string, number> = {};
        activeSubs.forEach((s: any) => {
            const slug = s.plan?.slug || 'unknown';
            planDist[slug] = (planDist[slug] || 0) + 1;
        });

        // Customer counts
        const activeCustomers = activeSubs.filter((s: any) => s.status === 'active').length;
        const trialingCustomers = activeSubs.filter((s: any) => s.status === 'trialing').length;

        // New customers this month
        const newCustomers = await this.prisma.tenant.count({
            where: { createdAt: { gte: monthStart, lte: monthEnd } },
        });

        // Cancelled this month
        const churnedCustomers = await this.prisma.billingSubscription.count({
            where: {
                status: { in: ['cancelled', 'expired'] },
                cancelledAt: { gte: monthStart, lte: monthEnd },
                ...COMMERCIAL_SUBSCRIPTIONS,
            },
        });

        // Payments
        const payments = await this.prisma.billingPayment.findMany({
            where: { createdAt: { gte: monthStart, lte: monthEnd }, ...COMMERCIAL_PAYMENTS },
        });
        const succeeded = payments.filter((p: any) => p.status === 'succeeded');
        const failed = payments.filter((p: any) => p.status === 'failed');
        const revenueCollected = succeeded.reduce((sum: number, p: any) => sum + p.amountCents, 0);

        // Infra costs for the month
        const infraCosts = await this.prisma.infraCost.findMany({
            where: { month: monthStart },
        });
        const infraTotal = infraCosts.reduce((sum: number, c: any) => sum + c.amountCents, 0);

        // LLM costs — aggregate from tenant schemas
        let llmCostTotal = 0;
        const tenantSnapshots: Array<{
            tenantId: string;
            snapshotMonth: Date;
            planSlug: string;
            mrrCents: number;
            status: string;
            revenueCents: number;
            llmCostCents: number;
            aiMessages: number;
            conversations: number;
        }> = [];

        for (const sub of activeSubs) {
            const tenant = sub.tenant;
            if (!tenant?.schemaName) continue;
            try {
                // LLM cost — read from Redis stats (LLMRouter.trackStats writes
                // per-call cost in centi-USD with 90d TTL). This is the only
                // place per-call cost is captured; messages.metadata.llmCost
                // is not populated in the current pipeline.
                const stats = await this.llmRouter.getStats({
                    since: monthStart,
                    until: monthEnd,
                    tenantId: tenant.id,
                });
                // costUsd is in dollars; convert to cents (×100).
                const tenantLlmCost = Math.round((stats.totals.costUsd || 0) * 100);
                llmCostTotal += tenantLlmCost;

                const tenantRevenue = succeeded
                    .filter((p: any) => p.tenantId === tenant.id)
                    .reduce((sum: number, p: any) => sum + p.amountCents, 0);

                tenantSnapshots.push({
                    tenantId: tenant.id,
                    snapshotMonth: monthStart,
                    planSlug: sub.plan?.slug || 'unknown',
                    mrrCents: sub.plan?.priceUsdCents || 0,
                    status: sub.status,
                    revenueCents: tenantRevenue,
                    llmCostCents: tenantLlmCost,
                    aiMessages: stats.totals.calls || 0,
                    conversations: 0,
                });
            } catch (e: any) {
                this.logger.warn(
                    `Failed to aggregate LLM costs for tenant ${tenant.id}: ${e.message}`,
                );
            }
        }

        // MRR movements — compare with previous month
        const prevSnapshot = await this.prisma.financialSnapshot.findFirst({
            orderBy: { snapshotMonth: 'desc' },
        });
        const prevTenantSnapshots = prevSnapshot
            ? await this.prisma.tenantFinancialSnapshot.findMany({
                  where: { snapshotMonth: { lt: monthStart } },
                  orderBy: { snapshotMonth: 'desc' },
                  distinct: ['tenantId'],
              })
            : [];

        const prevMap = new Map<string, { mrrCents: number; [key: string]: any }>(prevTenantSnapshots.map((s: any) => [s.tenantId, s]));
        const currMap = new Map<string, { mrrCents: number; [key: string]: any }>(tenantSnapshots.map((s: any) => [s.tenantId, s]));

        let newMrr = 0;
        let expansionMrr = 0;
        let contractionMrr = 0;
        let churnedMrr = 0;
        const reactivationMrr = 0;

        for (const [tid, curr] of currMap.entries()) {
            const prev = prevMap.get(tid);
            if (!prev) {
                newMrr += curr.mrrCents;
            } else if (curr.mrrCents > prev.mrrCents) {
                expansionMrr += curr.mrrCents - prev.mrrCents;
            } else if (curr.mrrCents < prev.mrrCents) {
                contractionMrr += prev.mrrCents - curr.mrrCents;
            }
        }
        for (const [tid, prev] of prevMap.entries()) {
            if (!currMap.has(tid)) {
                churnedMrr += prev.mrrCents;
            }
        }

        // Upsert financial snapshot
        await this.prisma.financialSnapshot.upsert({
            where: { snapshotMonth: monthStart },
            create: {
                snapshotMonth: monthStart,
                mrrCents,
                newMrrCents: newMrr,
                expansionMrrCents: expansionMrr,
                contractionMrrCents: contractionMrr,
                churnedMrrCents: churnedMrr,
                reactivationMrrCents: reactivationMrr,
                activeCustomers,
                newCustomers,
                churnedCustomers,
                trialingCustomers,
                trialsStarted: newCustomers,
                trialsConverted: 0,
                revenueCollectedCents: revenueCollected,
                paymentsSucceeded: succeeded.length,
                paymentsFailed: failed.length,
                llmCostCents: llmCostTotal,
                infraCostCents: infraTotal,
                planDistribution: planDist,
            },
            update: {
                mrrCents,
                newMrrCents: newMrr,
                expansionMrrCents: expansionMrr,
                contractionMrrCents: contractionMrr,
                churnedMrrCents: churnedMrr,
                reactivationMrrCents: reactivationMrr,
                activeCustomers,
                newCustomers,
                churnedCustomers,
                trialingCustomers,
                revenueCollectedCents: revenueCollected,
                paymentsSucceeded: succeeded.length,
                paymentsFailed: failed.length,
                llmCostCents: llmCostTotal,
                infraCostCents: infraTotal,
                planDistribution: planDist,
            },
        });

        // Upsert tenant snapshots
        for (const ts of tenantSnapshots) {
            await this.prisma.tenantFinancialSnapshot.upsert({
                where: {
                    tenantId_snapshotMonth: {
                        tenantId: ts.tenantId,
                        snapshotMonth: ts.snapshotMonth,
                    },
                },
                create: ts,
                update: ts,
            });
        }

        this.logger.log(
            `Financial snapshot generated: MRR=${mrrCents}c, active=${activeCustomers}, churned=${churnedCustomers}, LLM=${llmCostTotal}c`,
        );
    }
}
