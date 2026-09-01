import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { COMMERCIAL_PAYMENTS, COMMERCIAL_SUBSCRIPTIONS, internalTenantIds } from './commercial-scope.util';
import { sumInUsdCents, toUsdCents, usdRateMap } from './fx.util';

@Injectable()
export class FinancialsService {
    private readonly logger = new Logger(FinancialsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    // GET /financials/overview
    async getOverview() {
        // MRR: sum of active subscription plan prices
        const activeSubs = await this.prisma.billingSubscription.findMany({
            where: { status: 'active', ...COMMERCIAL_SUBSCRIPTIONS },
            include: { plan: true },
        });
        const mrrCents = activeSubs.reduce((sum: number, s: any) => sum + (s.plan?.priceUsdCents || 0), 0);
        const activeCustomers = activeSubs.length;
        const arpu = activeCustomers > 0 ? mrrCents / activeCustomers : 0;
        const arr = mrrCents * 12;

        // Get latest snapshot for churn/LTV
        const latestSnapshot = await this.prisma.financialSnapshot.findFirst({
            orderBy: { snapshotMonth: 'desc' },
        });

        const customerChurnRate =
            latestSnapshot && latestSnapshot.activeCustomers > 0
                ? latestSnapshot.churnedCustomers / latestSnapshot.activeCustomers
                : 0;
        const revenueChurnRate =
            latestSnapshot && latestSnapshot.mrrCents > 0
                ? latestSnapshot.churnedMrrCents / latestSnapshot.mrrCents
                : 0;
        const ltv = customerChurnRate > 0 ? Math.round(arpu / customerChurnRate) : 0;
        const quickRatio = latestSnapshot
            ? (latestSnapshot.newMrrCents + latestSnapshot.expansionMrrCents) /
              Math.max(1, latestSnapshot.contractionMrrCents + latestSnapshot.churnedMrrCents)
            : 0;

        // Trial metrics
        const trialingSubs = await this.prisma.billingSubscription.count({
            where: { status: 'trialing', ...COMMERCIAL_SUBSCRIPTIONS },
        });

        return {
            mrrCents,
            arrCents: arr,
            activeCustomers,
            arpuCents: Math.round(arpu),
            customerChurnRate: Math.round(customerChurnRate * 10000) / 100,
            revenueChurnRate: Math.round(revenueChurnRate * 10000) / 100,
            ltvCents: ltv,
            quickRatio: Math.round(quickRatio * 100) / 100,
            trialingCustomers: trialingSubs,
        };
    }

    // GET /financials/mrr-trend?months=12
    async getMrrTrend(months: number = 12) {
        const snapshots = await this.prisma.financialSnapshot.findMany({
            orderBy: { snapshotMonth: 'desc' },
            take: months,
        });
        return snapshots.reverse().map((s: any) => ({
            month: s.snapshotMonth,
            mrr: s.mrrCents,
            newMrr: s.newMrrCents,
            expansion: s.expansionMrrCents,
            contraction: s.contractionMrrCents,
            churned: s.churnedMrrCents,
            reactivation: s.reactivationMrrCents,
            netNew:
                s.newMrrCents +
                s.expansionMrrCents -
                s.contractionMrrCents -
                s.churnedMrrCents +
                s.reactivationMrrCents,
        }));
    }

    // GET /financials/revenue?months=12
    async getRevenueTrend(months: number = 12) {
        const snapshots = await this.prisma.financialSnapshot.findMany({
            orderBy: { snapshotMonth: 'desc' },
            take: months,
        });
        return snapshots.reverse().map((s: any) => ({
            month: s.snapshotMonth,
            revenue: s.revenueCollectedCents,
            paymentsSucceeded: s.paymentsSucceeded,
            paymentsFailed: s.paymentsFailed,
            successRate:
                s.paymentsSucceeded + s.paymentsFailed > 0
                    ? Math.round(
                          (s.paymentsSucceeded / (s.paymentsSucceeded + s.paymentsFailed)) * 100,
                      )
                    : 100,
        }));
    }

    // GET /financials/churn-trend?months=12
    async getChurnTrend(months: number = 12) {
        const snapshots = await this.prisma.financialSnapshot.findMany({
            orderBy: { snapshotMonth: 'desc' },
            take: months,
        });
        return snapshots.reverse().map((s: any) => ({
            month: s.snapshotMonth,
            customerChurnRate:
                s.activeCustomers > 0
                    ? Math.round((s.churnedCustomers / s.activeCustomers) * 10000) / 100
                    : 0,
            revenueChurnRate:
                s.mrrCents > 0
                    ? Math.round((s.churnedMrrCents / s.mrrCents) * 10000) / 100
                    : 0,
        }));
    }

    // GET /financials/costs?months=12
    async getCostsTrend(months: number = 12) {
        const snapshots = await this.prisma.financialSnapshot.findMany({
            orderBy: { snapshotMonth: 'desc' },
            take: months,
        });
        return snapshots.reverse().map((s: any) => {
            const totalCost = s.llmCostCents + s.infraCostCents;
            const grossMargin =
                s.revenueCollectedCents > 0
                    ? Math.round(
                          ((s.revenueCollectedCents - totalCost) / s.revenueCollectedCents) * 10000,
                      ) / 100
                    : 0;
            return {
                month: s.snapshotMonth,
                llmCost: s.llmCostCents,
                infraCost: s.infraCostCents,
                totalCost,
                grossMargin,
                revenue: s.revenueCollectedCents,
            };
        });
    }

    // GET /financials/tenant-profitability?month=2026-04
    async getTenantProfitability(month?: string) {
        const targetMonth = month
            ? new Date(month + '-01')
            : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const snapshots = await this.prisma.tenantFinancialSnapshot.findMany({
            where: {
                snapshotMonth: targetMonth,
                // Meses previos al alcance comercial traen filas de tenants internos.
                tenantId: { notIn: await internalTenantIds(this.prisma) },
            },
        });
        // Get tenant names
        const tenantIds = snapshots.map((s: any) => s.tenantId);
        const tenants = await this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true },
        });
        const nameMap = Object.fromEntries(tenants.map((t: any) => [t.id, t.name]));

        return snapshots.map((s: any) => ({
            tenantId: s.tenantId,
            tenantName: nameMap[s.tenantId] || 'Unknown',
            plan: s.planSlug,
            revenue: s.revenueCents,
            llmCost: s.llmCostCents,
            profit: s.revenueCents - s.llmCostCents,
            margin:
                s.revenueCents > 0
                    ? Math.round(
                          ((s.revenueCents - s.llmCostCents) / s.revenueCents) * 10000,
                      ) / 100
                    : 0,
        }));
    }

    // GET /financials/trial-metrics
    async getTrialMetrics() {
        const trialingSubs = await this.prisma.billingSubscription.findMany({
            where: { status: 'trialing', ...COMMERCIAL_SUBSCRIPTIONS },
            include: { tenant: { select: { name: true } } },
        });
        const trialsEndingSoon = trialingSubs.filter((s: any) => {
            if (!s.trialEndsAt) return false;
            const daysLeft = (new Date(s.trialEndsAt).getTime() - Date.now()) / 86400000;
            return daysLeft >= 0 && daysLeft <= 7;
        });
        // Last snapshot for conversion data
        const snapshot = await this.prisma.financialSnapshot.findFirst({
            orderBy: { snapshotMonth: 'desc' },
        });
        return {
            activeTrials: trialingSubs.length,
            trialsEndingSoon: trialsEndingSoon.length,
            conversionRate:
                snapshot && snapshot.trialsStarted > 0
                    ? Math.round((snapshot.trialsConverted / snapshot.trialsStarted) * 10000) / 100
                    : 0,
            trialsEndingSoonList: trialsEndingSoon.map((s: any) => ({
                tenantId: s.tenantId,
                tenantName: (s as any).tenant?.name,
                trialEndsAt: s.trialEndsAt,
            })),
        };
    }

    /**
     * GET /financials/activation
     *
     * Onboarding activation & time-to-first-value (TTFV), derived from existing
     * data (no event instrumentation needed, backfills history): a tenant is
     * "activated" once it has >=1 active channel. TTFV = first active channel
     * created_at minus the onboarding baseline (onboarding_completed_at, falling
     * back to created_at). This is the metric the guided onboarding optimizes.
     */
    async getActivationMetrics() {
        const agg: any[] = await this.prisma.$queryRawUnsafe(`
            WITH first_channel AS (
                SELECT tenant_id, MIN(created_at) AS first_at
                FROM channel_accounts
                WHERE is_active = true
                GROUP BY tenant_id
            ),
            ttfv AS (
                SELECT EXTRACT(EPOCH FROM (fc.first_at - COALESCE(t.onboarding_completed_at, t.created_at))) AS secs
                FROM tenants t
                JOIN first_channel fc ON fc.tenant_id = t.id
                WHERE fc.first_at >= COALESCE(t.onboarding_completed_at, t.created_at)
            )
            SELECT
                (SELECT COUNT(*)::int FROM tenants) AS total_tenants,
                (SELECT COUNT(*)::int FROM first_channel) AS activated_tenants,
                (SELECT COUNT(*)::int FROM ttfv) AS ttfv_count,
                (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) FROM ttfv) AS median_secs,
                (SELECT AVG(secs) FROM ttfv) AS avg_secs,
                (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY secs) FROM ttfv) AS p90_secs,
                (SELECT COUNT(*)::int FROM ttfv WHERE secs <= 900) AS under_15min,
                (SELECT COUNT(*)::int FROM ttfv WHERE secs <= 3600) AS under_1h,
                (SELECT COUNT(*)::int FROM ttfv WHERE secs <= 86400) AS under_24h
        `);
        const a: any = agg?.[0] || {};

        const breakdown: any[] = await this.prisma.$queryRawUnsafe(`
            SELECT channel_type, COUNT(*)::int AS count
            FROM (
                SELECT DISTINCT ON (tenant_id) tenant_id, channel_type
                FROM channel_accounts
                WHERE is_active = true
                ORDER BY tenant_id, created_at ASC
            ) firsts
            GROUP BY channel_type
            ORDER BY count DESC
        `);

        const total = Number(a.total_tenants || 0);
        const activated = Number(a.activated_tenants || 0);
        const sample = Number(a.ttfv_count || 0);
        const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

        return {
            totalTenants: total,
            activatedTenants: activated,
            notActivated: total - activated,
            activationRate: pct(activated, total),
            ttfv: {
                sampleSize: sample,
                medianSeconds: a.median_secs != null ? Math.round(Number(a.median_secs)) : null,
                avgSeconds: a.avg_secs != null ? Math.round(Number(a.avg_secs)) : null,
                p90Seconds: a.p90_secs != null ? Math.round(Number(a.p90_secs)) : null,
                under15minRate: pct(Number(a.under_15min || 0), sample),
                under1hRate: pct(Number(a.under_1h || 0), sample),
                under24hRate: pct(Number(a.under_24h || 0), sample),
            },
            firstChannelBreakdown: (breakdown || []).map((r: any) => ({
                channelType: r.channel_type,
                count: Number(r.count || 0),
            })),
        };
    }

    /**
     * GET /financials/forecast?monthsAhead=6&monthsHistory=6
     *
     * Linear-regression forecast on FinancialSnapshot history.
     * Projects MRR, active customers, and revenue forward N months
     * with a 95% confidence band (1.96σ on residuals).
     *
     * Returns null projection if there are fewer than 3 historical
     * snapshots — regression is meaningless on 2 points.
     */
    async getForecast(monthsAhead = 6, monthsHistory = 6) {
        const snapshots = await this.prisma.financialSnapshot.findMany({
            orderBy: { snapshotMonth: 'desc' },
            take: monthsHistory,
        });
        if (snapshots.length < 3) {
            return {
                history: [],
                forecast: [],
                metadata: {
                    insufficientData: true,
                    historyMonths: snapshots.length,
                    requiredMonths: 3,
                },
            };
        }

        const history = [...snapshots].reverse(); // oldest → newest
        const xs = history.map((_, i) => i);

        const mrrFit = this.linearFit(xs, history.map((s: any) => s.mrrCents));
        const customersFit = this.linearFit(xs, history.map((s: any) => s.activeCustomers));
        const revenueFit = this.linearFit(xs, history.map((s: any) => s.revenueCollectedCents));

        // Forecast points start one month after the last historical snapshot
        const lastDate = new Date(history[history.length - 1].snapshotMonth);
        const forecast: Array<{
            month: Date;
            projectedMrrCents: number;
            projectedMrrLowerCents: number;
            projectedMrrUpperCents: number;
            projectedRevenueCents: number;
            projectedActiveCustomers: number;
        }> = [];

        for (let i = 1; i <= monthsAhead; i++) {
            const x = history.length - 1 + i;
            const projMrr = Math.max(0, Math.round(mrrFit.slope * x + mrrFit.intercept));
            const projRevenue = Math.max(0, Math.round(revenueFit.slope * x + revenueFit.intercept));
            const projCustomers = Math.max(0, Math.round(customersFit.slope * x + customersFit.intercept));
            // 95% CI widens with horizon — multiply σ by sqrt(steps) for prediction variance
            const margin = Math.round(1.96 * mrrFit.residualStdDev * Math.sqrt(i));
            const month = new Date(lastDate.getFullYear(), lastDate.getMonth() + i, 1);
            forecast.push({
                month,
                projectedMrrCents: projMrr,
                projectedMrrLowerCents: Math.max(0, projMrr - margin),
                projectedMrrUpperCents: projMrr + margin,
                projectedRevenueCents: projRevenue,
                projectedActiveCustomers: projCustomers,
            });
        }

        // Average MoM growth rate over the historical window — useful number for
        // the dashboard headline ("growing 8.4%/mo") even if the regression
        // captures the line.
        const momRates: number[] = [];
        for (let i = 1; i < history.length; i++) {
            const prev = (history[i - 1] as any).mrrCents;
            const curr = (history[i] as any).mrrCents;
            if (prev > 0) momRates.push((curr - prev) / prev);
        }
        const avgMoMGrowth = momRates.length > 0
            ? momRates.reduce((a, b) => a + b, 0) / momRates.length
            : 0;

        return {
            history: history.map((s: any) => ({
                month: s.snapshotMonth,
                mrr: s.mrrCents,
                revenue: s.revenueCollectedCents,
                activeCustomers: s.activeCustomers,
            })),
            forecast,
            metadata: {
                insufficientData: false,
                historyMonths: history.length,
                avgMoMGrowthPct: Math.round(avgMoMGrowth * 10000) / 100,
                rSquared: Math.round(mrrFit.rSquared * 100) / 100,
                projected3MonthMrrCents: forecast[2]?.projectedMrrCents ?? null,
                projected6MonthMrrCents: forecast[5]?.projectedMrrCents ?? null,
                projected12MonthMrrCents: forecast.length >= 12 ? forecast[11].projectedMrrCents : null,
            },
        };
    }

    /**
     * Ordinary least squares fit + residual stddev + R². Pure function,
     * no external deps. We use sample stddev (n-2) for the residual to
     * be conservative on small histories.
     */
    private linearFit(xs: number[], ys: number[]) {
        const n = xs.length;
        const meanX = xs.reduce((a, b) => a + b, 0) / n;
        const meanY = ys.reduce((a, b) => a + b, 0) / n;

        let num = 0; // Σ(x-mean)(y-mean)
        let den = 0; // Σ(x-mean)²
        let totVar = 0; // Σ(y-mean)² for R²
        for (let i = 0; i < n; i++) {
            num += (xs[i] - meanX) * (ys[i] - meanY);
            den += (xs[i] - meanX) ** 2;
            totVar += (ys[i] - meanY) ** 2;
        }
        const slope = den === 0 ? 0 : num / den;
        const intercept = meanY - slope * meanX;

        let rss = 0; // residual sum of squares
        for (let i = 0; i < n; i++) {
            const yhat = slope * xs[i] + intercept;
            rss += (ys[i] - yhat) ** 2;
        }
        const residualStdDev = n > 2 ? Math.sqrt(rss / (n - 2)) : 0;
        const rSquared = totVar === 0 ? 1 : 1 - rss / totVar;

        return { slope, intercept, residualStdDev, rSquared };
    }

    /**
     * POST /financials/snapshots/backfill-revenue
     *
     * Recalcula, para cada snapshot ya existente, SOLO los campos derivados de
     * pagos (revenue, conteos, desglose por moneda y el revenue por tenant),
     * porque `billing_payments` es inmutable y permite rehacerlos con la
     * semántica actual: alcance comercial + normalización a USD. Los campos
     * derivados del estado de suscripciones (MRR, customers) NO se tocan — el
     * estado histórico de las suscripciones es irrecuperable y reescribirlos
     * con el estado de hoy falsearía la serie. Idempotente.
     */
    async backfillSnapshotRevenue() {
        const snapshots = await this.prisma.financialSnapshot.findMany({
            orderBy: { snapshotMonth: 'asc' },
        });
        const results: Array<{
            month: string;
            revenueUsdCents: number;
            paymentsSucceeded: number;
            paymentsFailed: number;
            missingRates: string[];
            tenantRowsUpdated: number;
        }> = [];

        for (const snap of snapshots) {
            const monthStart = new Date(snap.snapshotMonth);
            // Mismo cálculo de fin de mes que generateSnapshot, para que ambos
            // caminos cubran exactamente la misma ventana.
            const monthEnd = new Date(
                monthStart.getFullYear(),
                monthStart.getMonth() + 1,
                0,
                23,
                59,
                59,
            );
            const payments = await this.prisma.billingPayment.findMany({
                where: { createdAt: { gte: monthStart, lte: monthEnd }, ...COMMERCIAL_PAYMENTS },
            });
            const succeeded = payments.filter((p: any) => p.status === 'succeeded');
            const failed = payments.filter((p: any) => p.status === 'failed');
            const fxRates = await usdRateMap(this.prisma, succeeded.map((p: any) => p.currency), monthEnd);
            const revenue = sumInUsdCents(succeeded, fxRates);
            if (revenue.missingRates.length) {
                this.logger.warn(
                    `Backfill ${monthStart.toISOString().slice(0, 7)}: sin tasa USD para ${revenue.missingRates.join(', ')} — ese revenue queda fuera del total.`,
                );
            }

            await this.prisma.financialSnapshot.update({
                where: { id: snap.id },
                data: {
                    revenueCollectedCents: revenue.usdCents,
                    paymentsSucceeded: succeeded.length,
                    paymentsFailed: failed.length,
                    revenueBreakdown: {
                        reportingCurrency: 'USD',
                        byCurrency: revenue.byCurrency,
                        missingRates: revenue.missingRates,
                    } as any,
                },
            });

            let tenantRowsUpdated = 0;
            const tenantSnapshots = await this.prisma.tenantFinancialSnapshot.findMany({
                where: { snapshotMonth: snap.snapshotMonth },
            });
            for (const ts of tenantSnapshots) {
                const tenantRevenue = succeeded
                    .filter((p: any) => p.tenantId === ts.tenantId)
                    .reduce(
                        (sum: number, p: any) => sum + (toUsdCents(p.amountCents, p.currency, fxRates) ?? 0),
                        0,
                    );
                if (tenantRevenue !== ts.revenueCents) {
                    await this.prisma.tenantFinancialSnapshot.update({
                        where: { id: ts.id },
                        data: { revenueCents: tenantRevenue },
                    });
                    tenantRowsUpdated++;
                }
            }

            results.push({
                month: monthStart.toISOString().slice(0, 7),
                revenueUsdCents: revenue.usdCents,
                paymentsSucceeded: succeeded.length,
                paymentsFailed: failed.length,
                missingRates: revenue.missingRates,
                tenantRowsUpdated,
            });
        }

        return { months: results.length, results };
    }

    // POST /financials/infra-costs
    async upsertInfraCost(data: {
        month: string;
        category: string;
        amountCents: number;
        description?: string;
        createdBy?: string;
    }) {
        const monthDate = new Date(data.month + '-01');
        return this.prisma.infraCost.upsert({
            where: {
                month_category: { month: monthDate, category: data.category },
            },
            create: {
                month: monthDate,
                category: data.category,
                amountCents: data.amountCents,
                description: data.description,
                createdBy: data.createdBy,
            },
            update: {
                amountCents: data.amountCents,
                description: data.description,
            },
        });
    }

    // GET /financials/infra-costs?year=2026
    async getInfraCosts(year: number) {
        return this.prisma.infraCost.findMany({
            where: {
                month: {
                    gte: new Date(`${year}-01-01`),
                    lt: new Date(`${year + 1}-01-01`),
                },
            },
            orderBy: [{ month: 'asc' }, { category: 'asc' }],
        });
    }

    // POST /financials/exchange-rates
    async upsertExchangeRate(data: {
        rateDate: string;
        fromCurrency: string;
        toCurrency: string;
        rate: number;
    }) {
        const date = new Date(data.rateDate);
        return this.prisma.exchangeRate.upsert({
            where: {
                rateDate_fromCurrency_toCurrency: {
                    rateDate: date,
                    fromCurrency: data.fromCurrency,
                    toCurrency: data.toCurrency,
                },
            },
            create: {
                rateDate: date,
                fromCurrency: data.fromCurrency,
                toCurrency: data.toCurrency,
                rate: data.rate,
            },
            update: { rate: data.rate },
        });
    }
}
