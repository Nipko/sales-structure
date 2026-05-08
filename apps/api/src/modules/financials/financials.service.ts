import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

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
            where: { status: 'active' },
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
            where: { status: 'trialing' },
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
            where: { snapshotMonth: targetMonth },
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
            where: { status: 'trialing' },
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
