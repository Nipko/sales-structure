import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getVerticalCatalog } from '../../common/utils/vertical-catalog.util';

type StatsStatus = 'ok' | 'no_data' | 'query_error' | 'unsupported';

interface StatsExecution {
    stats: Record<string, any> | null;
    statsStatus: StatsStatus;
    statsError: { code?: string; message: string } | null;
}

/**
 * Cross-tenant analytics aggregator for super_admin. Iterates per-tenant
 * schemas to build platform-wide metrics for every vertical, plus
 * activation gap detection (tenants who signed up for a vertical but
 * haven't populated its core entities — usually a sign of incomplete
 * onboarding).
 *
 * Caching: Redis 5-minute TTL on platform-wide aggregates, 60-second
 * TTL on per-tenant snapshots. Calls are read-only and tolerate per-
 * schema failures (try/catch each tenant) so a single broken schema
 * doesn't block the whole report.
 */
@Injectable()
export class VerticalAnalyticsService {
    private readonly logger = new Logger(VerticalAnalyticsService.name);
    private readonly OVERVIEW_TTL = 300;
    private readonly TENANT_TTL = 60;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    // ── Cross-vertical overview ───────────────────────────────────

    async getOverview(forceRefresh = false): Promise<any> {
        const cacheKey = 'vertical_analytics:overview';
        if (!forceRefresh) {
            const cached = await this.redis.getJson<any>(cacheKey);
            if (cached) return cached;
        }

        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: {
                id: true, name: true, slug: true, industry: true,
                schemaName: true, plan: true, createdAt: true,
                onboardingCompletedAt: true, firstMessageAt: true,
                subscriptionStatus: true, settings: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        // Distribution by industry
        type IndustryRow = {
            industry: string;
            count: number;
            activated: number;
            paying: number;
            trialing: number;
            recent7d: number;
            subTypes: Record<string, number>;
        };
        const byIndustry = new Map<string, IndustryRow>();

        for (const t of tenants as any[]) {
            const key = t.industry || 'otro';
            const settings: any = t.settings || {};
            const subType: string | null = settings.subType || settings.verticalConfig?.subType || null;
            const row: IndustryRow = byIndustry.get(key) || {
                industry: key, count: 0, activated: 0, paying: 0, trialing: 0,
                recent7d: 0, subTypes: {} as Record<string, number>,
            };
            row.count += 1;
            if (t.firstMessageAt) row.activated += 1;
            if (t.subscriptionStatus === 'active' || t.subscriptionStatus === 'past_due') row.paying += 1;
            if (t.subscriptionStatus === 'trialing') row.trialing += 1;
            if (t.createdAt && (Date.now() - new Date(t.createdAt).getTime()) < 7 * 86_400_000) row.recent7d += 1;
            if (subType) row.subTypes[subType] = (row.subTypes[subType] || 0) + 1;
            byIndustry.set(key, row);
        }

        // Activation gaps — tenants whose vertical lacks the core entity
        // they need to actually use their AI agent. Iterates only tenants
        // with the relevant industries to keep the cost bounded.
        const gapsResult = await this.detectActivationGaps(tenants as any[]);

        const totals = {
            tenantsTotal: tenants.length,
            tenantsActivated: tenants.filter((t: any) => t.firstMessageAt).length,
            tenantsPaying: tenants.filter((t: any) =>
                t.subscriptionStatus === 'active' || t.subscriptionStatus === 'past_due',
            ).length,
            tenantsTrialing: tenants.filter((t: any) => t.subscriptionStatus === 'trialing').length,
            tenantsRecent7d: tenants.filter((t: any) =>
                t.createdAt && (Date.now() - new Date(t.createdAt).getTime()) < 7 * 86_400_000,
            ).length,
            industriesCovered: byIndustry.size,
        };

        const result = {
            generatedAt: new Date().toISOString(),
            totals,
            byIndustry: Array.from(byIndustry.values()).sort((a, b) => b.count - a.count),
            activationGaps: gapsResult.gaps,
            activationGapErrors: gapsResult.errors,
        };

        await this.redis.setJson(cacheKey, result, this.OVERVIEW_TTL);
        return result;
    }

    /**
     * For each vertical with a domain-specific table, count tenants who
     * have zero rows in that table (a strong signal that they signed up
     * but never finished setup). Used by ops to nudge stuck tenants.
     */
    private async detectActivationGaps(tenants: any[]): Promise<{
        gaps: Array<{
            industry: string;
            tenantId: string;
            tenantName: string;
            missing: string;
        }>;
        errors: Array<{
            industry: string;
            tenantId: string;
            tenantName: string;
            code?: string;
            message: string;
        }>;
    }> {
        const gaps: any[] = [];
        const errors: any[] = [];
        // Una sola definicion del catalogo por vertical, compartida con el
        // checklist del tenant (persona.controller). Estaban duplicadas y ya
        // habian divergido: aca turismo contaba tour_packages y reportaba
        // missing:'properties', asi que el super admin leia que al tenant le
        // faltaban propiedades mirando tours. Ademas faltaban automotriz,
        // retail y otro — verticales cuyo negocio ES el catalogo.
        for (const t of tenants) {
            const settings = (t.settings || {}) as any;
            const subType = settings.subType || settings.verticalConfig?.subType || null;
            const check = getVerticalCatalog(t.industry, subType);
            if (!check || !t.schemaName) continue;
            try {
                const filter = check.activeFilter ? `WHERE ${check.activeFilter}` : '';
                const rows = await this.prisma.executeInTenantSchema<any[]>(
                    t.schemaName,
                    `SELECT COUNT(*)::int AS cnt FROM ${check.table} ${filter}`,
                );
                const cnt = rows[0]?.cnt || 0;
                if (cnt === 0) {
                    gaps.push({
                        industry: t.industry,
                        tenantId: t.id,
                        tenantName: t.name,
                        missing: check.missingKey,
                    });
                }
            } catch (error: any) {
                // Missing/outdated schema is not the same as an empty catalog.
                // Expose it to super-admin instead of silently certifying setup.
                errors.push({
                    industry: t.industry,
                    tenantId: t.id,
                    tenantName: t.name,
                    ...queryErrorDetails(error),
                });
            }
        }
        return { gaps: gaps.slice(0, 50), errors: errors.slice(0, 50) };
    }

    // ── Per-vertical drilldown ────────────────────────────────────

    async getIndustryDrilldown(industry: string, forceRefresh = false): Promise<any> {
        const cacheKey = `vertical_analytics:industry:${industry}`;
        if (!forceRefresh) {
            const cached = await this.redis.getJson<any>(cacheKey);
            if (cached) return cached;
        }

        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true, industry },
            select: { id: true, name: true, slug: true, schemaName: true, plan: true, createdAt: true, firstMessageAt: true },
        });

        const aggregator: AggregatorFn | undefined = INDUSTRY_AGGREGATORS[industry];
        const tenantsData = await Promise.all(
            (tenants as any[]).map(async (t) => {
                const execution = aggregator
                    ? await executeAggregator(aggregator, this.prisma, t.schemaName)
                    : unsupportedStats();
                return {
                    tenantId: t.id,
                    tenantName: t.name,
                    plan: t.plan,
                    createdAt: t.createdAt,
                    firstMessageAt: t.firstMessageAt,
                    ...execution,
                };
            }),
        );

        // Aggregate platform totals for this industry
        const hasAggregator = !!INDUSTRY_AGGREGATORS[industry];
        const successfulTenants = tenantsData.filter((t) => t.statsStatus === 'ok' || t.statsStatus === 'no_data');
        const queryErrorCount = tenantsData.filter((t) => t.statsStatus === 'query_error').length;
        const totals = hasAggregator && successfulTenants.length
            ? aggregateIndustryTotals(industry, successfulTenants)
            : null;
        const totalsStatus: StatsStatus | 'partial_error' = !hasAggregator
            ? 'unsupported'
            : successfulTenants.length === 0 && queryErrorCount > 0
                ? 'query_error'
                : queryErrorCount > 0
                    ? 'partial_error'
                    : successfulTenants.some((t) => t.statsStatus === 'ok')
                        ? 'ok'
                        : 'no_data';

        const result = {
            industry,
            generatedAt: new Date().toISOString(),
            tenantCount: tenants.length,
            totals,
            totalsStatus,
            queryErrorCount,
            tenants: tenantsData.sort((a: any, b: any) => {
                // Sort by primary metric (e.g. orders for restaurants, members for gyms)
                const aVal = a.stats ? primaryMetricValue(industry, a.stats) : 0;
                const bVal = b.stats ? primaryMetricValue(industry, b.stats) : 0;
                return bVal - aVal;
            }),
        };

        await this.redis.setJson(cacheKey, result, this.OVERVIEW_TTL);
        return result;
    }

    // ── Per-tenant snapshot ───────────────────────────────────────

    async getTenantSnapshot(tenantId: string, forceRefresh = false): Promise<any> {
        const cacheKey = `vertical_analytics:tenant:${tenantId}`;
        if (!forceRefresh) {
            const cached = await this.redis.getJson<any>(cacheKey);
            if (cached) return cached;
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, name: true, industry: true, schemaName: true, settings: true },
        });
        if (!tenant) return null;

        const industry = tenant.industry;
        const aggregator: AggregatorFn | undefined = INDUSTRY_AGGREGATORS[industry];
        const execution = aggregator
            ? await executeAggregator(aggregator, this.prisma, tenant.schemaName)
            : unsupportedStats();

        const result = {
            tenantId,
            industry,
            subType: (tenant.settings as any)?.subType || null,
            ...execution,
            generatedAt: new Date().toISOString(),
        };
        await this.redis.setJson(cacheKey, result, this.TENANT_TTL);
        return result;
    }
}

// ─────────────────────────────────────────────────────────────────
// Per-vertical aggregators — read-only counts + computed KPIs
// ─────────────────────────────────────────────────────────────────

type AggregatorFn = (prisma: PrismaService, schemaName: string) => Promise<Record<string, any>>;

function queryErrorDetails(error: any): { code?: string; message: string } {
    const code = typeof error?.code === 'string' ? error.code : undefined;
    const message = typeof error?.message === 'string' && error.message.trim()
        ? error.message
        : 'Unknown vertical analytics query error';
    return code ? { code, message } : { message };
}

function unsupportedStats(): StatsExecution {
    return { stats: null, statsStatus: 'unsupported', statsError: null };
}

function hasMetricData(stats: Record<string, any>): boolean {
    return Object.values(stats).some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
}

async function executeAggregator(
    aggregator: AggregatorFn,
    prisma: PrismaService,
    schemaName: string,
): Promise<StatsExecution> {
    try {
        const stats = await aggregator(prisma, schemaName);
        return {
            stats,
            statsStatus: hasMetricData(stats) ? 'ok' : 'no_data',
            statsError: null,
        };
    } catch (error: any) {
        return {
            stats: null,
            statsStatus: 'query_error',
            statsError: queryErrorDetails(error),
        };
    }
}

// The second argument is retained as a type witness for the heterogeneous
// Promise.all tuples below. It is deliberately never returned: a failed query
// must surface as `query_error`, never masquerade as a successful zero.
async function requiredQuery<T>(query: () => Promise<T>, _typeWitness: T): Promise<T> {
    return query();
}

const INDUSTRY_AGGREGATORS: Record<string, AggregatorFn> = {
    moda_belleza: async (prisma, schema) => {
        const [services, appointments] = await Promise.all([
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM services WHERE is_active = true`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*) FILTER (
                        WHERE start_at >= NOW() - INTERVAL '30 days'
                          AND status <> 'cancelled'
                    )::int AS appointments_30d,
                    COUNT(*) FILTER (
                        WHERE start_at >= NOW() - INTERVAL '30 days'
                          AND status = 'completed'
                    )::int AS completed_30d,
                    COUNT(*) FILTER (
                        WHERE start_at >= NOW() - INTERVAL '30 days'
                          AND status = 'no_show'
                    )::int AS no_shows_30d,
                    COUNT(*) FILTER (
                        WHERE start_at >= NOW()
                          AND start_at < NOW() + INTERVAL '7 days'
                          AND status <> 'cancelled'
                    )::int AS upcoming_7d,
                    COUNT(DISTINCT contact_id) FILTER (
                        WHERE start_at >= NOW() - INTERVAL '30 days'
                          AND status <> 'cancelled'
                          AND contact_id IS NOT NULL
                    )::int AS customers_30d,
                    (
                        SELECT COUNT(*)::int
                        FROM (
                            SELECT contact_id
                            FROM appointments
                            WHERE start_at >= NOW() - INTERVAL '30 days'
                              AND status <> 'cancelled'
                              AND contact_id IS NOT NULL
                            GROUP BY contact_id
                            HAVING COUNT(*) >= 2
                        ) returning_customers
                    ) AS repeat_customers_30d
                 FROM appointments`),
        ]);
        const row = appointments[0] || {};
        const customers = Number(row.customers_30d || 0);
        const repeatCustomers = Number(row.repeat_customers_30d || 0);
        return {
            activeServices: Number(services[0]?.cnt || 0),
            appointments30d: Number(row.appointments_30d || 0),
            completedAppointments30d: Number(row.completed_30d || 0),
            noShows30d: Number(row.no_shows_30d || 0),
            appointmentsNext7d: Number(row.upcoming_7d || 0),
            uniqueCustomers30d: customers,
            repeatCustomers30d: repeatCustomers,
            repeatCustomerRatePct: customers > 0
                ? Math.round((repeatCustomers / customers) * 100)
                : 0,
        };
    },

    automotriz: async (prisma, schema) => {
        const [inventory, testDrives] = await Promise.all([
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'available')::int AS available,
                    COUNT(*) FILTER (WHERE status = 'reserved')::int AS reserved,
                    COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance,
                    COUNT(*) FILTER (
                        WHERE status = 'sold'
                          AND sold_at >= DATE_TRUNC('month', CURRENT_DATE)
                    )::int AS sold_this_month,
                    COALESCE(SUM(sold_price_cents) FILTER (
                        WHERE status = 'sold'
                          AND sold_at >= DATE_TRUNC('month', CURRENT_DATE)
                    ), 0)::bigint AS sold_revenue_cents_month,
                    COALESCE(AVG(price_cents) FILTER (WHERE status = 'available'), 0)::numeric AS avg_available_price_cents
                 FROM vehicles`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*) FILTER (
                        WHERE start_at >= DATE_TRUNC('month', CURRENT_DATE)
                          AND start_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
                          AND status <> 'cancelled'
                    )::int AS this_month,
                    COUNT(*) FILTER (
                        WHERE start_at >= NOW()
                          AND start_at < NOW() + INTERVAL '7 days'
                          AND status <> 'cancelled'
                    )::int AS next_7d
                 FROM appointments
                 WHERE metadata->>'vehicleId' IS NOT NULL`),
        ]);
        const stock = inventory[0] || {};
        const drives = testDrives[0] || {};
        return {
            vehiclesTotal: Number(stock.total || 0),
            vehiclesAvailable: Number(stock.available || 0),
            vehiclesReserved: Number(stock.reserved || 0),
            vehiclesMaintenance: Number(stock.maintenance || 0),
            vehiclesSoldThisMonth: Number(stock.sold_this_month || 0),
            soldRevenueCentsThisMonth: Number(stock.sold_revenue_cents_month || 0),
            avgAvailablePriceCents: Number(stock.avg_available_price_cents || 0),
            testDrivesThisMonth: Number(drives.this_month || 0),
            testDrivesNext7d: Number(drives.next_7d || 0),
        };
    },

    finanzas: async (prisma, schema) => {
        const [applications, appointments] = await Promise.all([
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*) FILTER (WHERE won_at IS NULL AND lost_at IS NULL)::int AS open_applications,
                    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS applications_30d,
                    COUNT(*) FILTER (WHERE won_at >= NOW() - INTERVAL '30 days')::int AS approved_30d,
                    COUNT(*) FILTER (WHERE lost_at >= NOW() - INTERVAL '30 days')::int AS rejected_30d,
                    COALESCE(SUM(estimated_value) FILTER (
                        WHERE won_at IS NULL AND lost_at IS NULL
                    ), 0)::numeric AS open_estimated_value
                 FROM opportunities`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt
                 FROM appointments
                 WHERE start_at >= NOW()
                   AND start_at < NOW() + INTERVAL '7 days'
                   AND status <> 'cancelled'`),
        ]);
        const row = applications[0] || {};
        const approved = Number(row.approved_30d || 0);
        const rejected = Number(row.rejected_30d || 0);
        const decided = approved + rejected;
        return {
            applicationsOpen: Number(row.open_applications || 0),
            applications30d: Number(row.applications_30d || 0),
            applicationsApproved30d: approved,
            applicationsRejected30d: rejected,
            approvalRatePct: decided > 0 ? Math.round((approved / decided) * 100) : 0,
            openEstimatedValue: Number(row.open_estimated_value || 0),
            consultationsNext7d: Number(appointments[0]?.cnt || 0),
        };
    },

    servicios_profesionales: async (prisma, schema) => {
        const [deals, appointments] = await Promise.all([
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*) FILTER (WHERE status = 'open')::int AS open_deals,
                    COUNT(*) FILTER (
                        WHERE status = 'won' AND updated_at >= NOW() - INTERVAL '30 days'
                    )::int AS won_30d,
                    COUNT(*) FILTER (
                        WHERE status = 'lost' AND updated_at >= NOW() - INTERVAL '30 days'
                    )::int AS lost_30d,
                    COALESCE(SUM(value) FILTER (WHERE status = 'open'), 0)::numeric AS pipeline_value,
                    COALESCE(SUM(value * probability / 100.0) FILTER (WHERE status = 'open'), 0)::numeric AS weighted_pipeline_value
                 FROM deals`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*) FILTER (
                        WHERE start_at >= NOW()
                          AND start_at < NOW() + INTERVAL '7 days'
                          AND status <> 'cancelled'
                    )::int AS next_7d,
                    COUNT(*) FILTER (
                        WHERE completed_at >= NOW() - INTERVAL '30 days'
                          AND status = 'completed'
                    )::int AS completed_30d
                 FROM appointments`),
        ]);
        const pipeline = deals[0] || {};
        const won = Number(pipeline.won_30d || 0);
        const lost = Number(pipeline.lost_30d || 0);
        return {
            openDeals: Number(pipeline.open_deals || 0),
            wonDeals30d: won,
            lostDeals30d: lost,
            winRate30d: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0,
            pipelineValue: Number(pipeline.pipeline_value || 0),
            weightedPipelineValue: Number(pipeline.weighted_pipeline_value || 0),
            consultationsNext7d: Number(appointments[0]?.next_7d || 0),
            consultationsCompleted30d: Number(appointments[0]?.completed_30d || 0),
        };
    },

    retail: async (prisma, schema) => {
        const [products, orders] = await Promise.all([
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE is_available = true)::int AS available,
                    COUNT(*) FILTER (WHERE is_available = true AND stock = 0)::int AS out_of_stock,
                    COALESCE(SUM(stock) FILTER (WHERE is_available = true AND stock IS NOT NULL), 0)::bigint AS stock_units
                 FROM products`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*) FILTER (
                        WHERE status NOT IN ('cancelled', 'refunded')
                    )::int AS orders_30d,
                    COUNT(*) FILTER (
                        WHERE status NOT IN ('cancelled', 'refunded')
                          AND payment_status = 'paid'
                    )::int AS paid_orders_30d,
                    COUNT(*) FILTER (
                        WHERE status IN ('pending', 'confirmed', 'processing')
                    )::int AS pending_orders_30d,
                    COALESCE(SUM(total_amount) FILTER (
                        WHERE status NOT IN ('cancelled', 'refunded')
                    ), 0)::numeric AS gmv_30d
                 FROM orders
                 WHERE created_at >= NOW() - INTERVAL '30 days'`),
        ]);
        const catalog = products[0] || {};
        const sales = orders[0] || {};
        const orderCount = Number(sales.orders_30d || 0);
        const gmv = Number(sales.gmv_30d || 0);
        return {
            productsTotal: Number(catalog.total || 0),
            productsAvailable: Number(catalog.available || 0),
            productsOutOfStock: Number(catalog.out_of_stock || 0),
            stockUnits: Number(catalog.stock_units || 0),
            orders30d: orderCount,
            paidOrders30d: Number(sales.paid_orders_30d || 0),
            pendingOrders30d: Number(sales.pending_orders_30d || 0),
            gmv30d: gmv,
            averageOrderValue30d: orderCount > 0 ? Math.round((gmv / orderCount) * 100) / 100 : 0,
        };
    },

    technology: async (prisma, schema) => {
        const [companies, deals, cycle, demos] = await Promise.all([
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM companies`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*) FILTER (WHERE status = 'open')::int AS open_deals,
                    COUNT(*) FILTER (
                        WHERE status = 'won' AND updated_at >= NOW() - INTERVAL '30 days'
                    )::int AS won_30d,
                    COUNT(*) FILTER (
                        WHERE status = 'lost' AND updated_at >= NOW() - INTERVAL '30 days'
                    )::int AS lost_30d,
                    COALESCE(SUM(value) FILTER (WHERE status = 'open'), 0)::numeric AS pipeline_value,
                    COALESCE(SUM(value * probability / 100.0) FILTER (WHERE status = 'open'), 0)::numeric AS weighted_pipeline_value
                 FROM deals`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (won_at - created_at)) / 86400.0), 0)::numeric AS avg_days
                 FROM opportunities
                 WHERE won_at >= NOW() - INTERVAL '30 days'`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt
                 FROM appointments
                 WHERE start_at >= NOW()
                   AND start_at < NOW() + INTERVAL '7 days'
                   AND status <> 'cancelled'`),
        ]);
        const pipeline = deals[0] || {};
        const won = Number(pipeline.won_30d || 0);
        const lost = Number(pipeline.lost_30d || 0);
        return {
            companies: Number(companies[0]?.cnt || 0),
            openDeals: Number(pipeline.open_deals || 0),
            wonDeals30d: won,
            lostDeals30d: lost,
            winRate30d: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0,
            pipelineValue: Number(pipeline.pipeline_value || 0),
            weightedPipelineValue: Number(pipeline.weighted_pipeline_value || 0),
            avgSalesCycleDays30d: Math.round(Number(cycle[0]?.avg_days || 0) * 10) / 10,
            demosNext7d: Number(demos[0]?.cnt || 0),
        };
    },

    pet_services: async (prisma, schema) => {
        const [pets, services, appointments] = await Promise.all([
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM pets WHERE is_active = true`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM services WHERE is_active = true`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*) FILTER (
                        WHERE start_at >= NOW() - INTERVAL '30 days'
                          AND status <> 'cancelled'
                    )::int AS bookings_30d,
                    COUNT(*) FILTER (
                        WHERE start_at >= NOW() - INTERVAL '30 days'
                          AND status = 'completed'
                    )::int AS completed_30d,
                    COUNT(*) FILTER (
                        WHERE start_at >= NOW() - INTERVAL '30 days'
                          AND status = 'no_show'
                    )::int AS no_shows_30d,
                    COUNT(*) FILTER (
                        WHERE start_at >= NOW()
                          AND start_at < NOW() + INTERVAL '7 days'
                          AND status <> 'cancelled'
                    )::int AS next_7d,
                    COUNT(DISTINCT metadata->>'petId') FILTER (
                        WHERE start_at >= NOW() - INTERVAL '30 days'
                          AND status <> 'cancelled'
                          AND metadata->>'petId' IS NOT NULL
                    )::int AS pets_served_30d
                 FROM appointments`),
        ]);
        const bookings = appointments[0] || {};
        return {
            pets: Number(pets[0]?.cnt || 0),
            activeServices: Number(services[0]?.cnt || 0),
            bookings30d: Number(bookings.bookings_30d || 0),
            completedBookings30d: Number(bookings.completed_30d || 0),
            noShows30d: Number(bookings.no_shows_30d || 0),
            bookingsNext7d: Number(bookings.next_7d || 0),
            petsServed30d: Number(bookings.pets_served_30d || 0),
        };
    },

    otro: async (prisma, schema) => {
        const [contacts, conversations, deals, products, orders] = await Promise.all([
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_30d
                 FROM contacts`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt
                 FROM conversations WHERE created_at >= NOW() - INTERVAL '30 days'`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*) FILTER (WHERE status = 'open')::int AS open_deals,
                    COALESCE(SUM(value) FILTER (WHERE status = 'open'), 0)::numeric AS pipeline_value
                 FROM deals`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*) FILTER (WHERE is_available = true)::int AS cnt FROM products`),
            prisma.executeInTenantSchema<any[]>(schema,
                `SELECT
                    COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'refunded'))::int AS orders_30d,
                    COALESCE(SUM(total_amount) FILTER (
                        WHERE status NOT IN ('cancelled', 'refunded')
                    ), 0)::numeric AS gmv_30d
                 FROM orders
                 WHERE created_at >= NOW() - INTERVAL '30 days'`),
        ]);
        return {
            contactsTotal: Number(contacts[0]?.total || 0),
            newContacts30d: Number(contacts[0]?.new_30d || 0),
            conversations30d: Number(conversations[0]?.cnt || 0),
            openDeals: Number(deals[0]?.open_deals || 0),
            pipelineValue: Number(deals[0]?.pipeline_value || 0),
            catalogProducts: Number(products[0]?.cnt || 0),
            orders30d: Number(orders[0]?.orders_30d || 0),
            gmv30d: Number(orders[0]?.gmv_30d || 0),
        };
    },

    restaurantes: async (prisma, schema) => {
        const [items, ordersAll, ordersWeek, promotions, kitchenStates] = await Promise.all([
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM menu_items WHERE is_active = true`),
                [{ cnt: 0 }] as any),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(total), 0)::numeric AS gmv FROM food_orders`),
                [{ cnt: 0, gmv: 0 }] as any),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(total), 0)::numeric AS gmv FROM food_orders WHERE created_at >= NOW() - INTERVAL '7 days'`),
                [{ cnt: 0, gmv: 0 }] as any),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM menu_promotions WHERE is_active = true AND (valid_to IS NULL OR valid_to >= NOW())`),
                [{ cnt: 0 }] as any),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM food_orders
                 WHERE status NOT IN ('delivered', 'cancelled') GROUP BY status`),
                [] as any[]),
        ]);
        return {
            menuItems: items[0]?.cnt || 0,
            ordersTotal: ordersAll[0]?.cnt || 0,
            gmvTotal: Number(ordersAll[0]?.gmv || 0),
            ordersWeek: ordersWeek[0]?.cnt || 0,
            gmvWeek: Number(ordersWeek[0]?.gmv || 0),
            activePromotions: promotions[0]?.cnt || 0,
            kitchenInProgress: kitchenStates.reduce((sum: number, r: any) => sum + r.cnt, 0),
        };
    },

    gimnasios: async (prisma, schema) => {
        const [plans, members, classesUpcoming, checkIns7d] = await Promise.all([
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM membership_plans WHERE is_active = true`),
                [{ cnt: 0 }] as any),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM members GROUP BY status`),
                [] as any[]),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(max_capacity - available_spots), 0)::int AS booked, COALESCE(SUM(max_capacity), 0)::int AS capacity
                 FROM fitness_classes
                 WHERE is_cancelled = false AND scheduled_at >= NOW() AND scheduled_at <= NOW() + INTERVAL '7 days'`),
                [{ cnt: 0, booked: 0, capacity: 0 }] as any),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM member_check_ins WHERE checked_in_at >= NOW() - INTERVAL '7 days'`),
                [{ cnt: 0 }] as any),
        ]);
        const memberCounts = (members as any[]).reduce((acc: any, r: any) => {
            acc[r.status] = r.cnt;
            return acc;
        }, {});
        const cap = Number(classesUpcoming[0]?.capacity || 0);
        const booked = Number(classesUpcoming[0]?.booked || 0);
        return {
            plans: plans[0]?.cnt || 0,
            membersActive: memberCounts.active || 0,
            membersFrozen: memberCounts.frozen || 0,
            membersExpired: memberCounts.expired || 0,
            membersCancelled: memberCounts.cancelled || 0,
            classesNext7d: classesUpcoming[0]?.cnt || 0,
            classFillRatePct: cap > 0 ? Math.round((booked / cap) * 100) : 0,
            checkInsWeek: checkIns7d[0]?.cnt || 0,
        };
    },

    education: async (prisma, schema) => {
        const [courses, cohorts, enrollments] = await Promise.all([
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM courses WHERE is_active = true`),
                [{ cnt: 0 }] as any),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM course_cohorts GROUP BY status`),
                [] as any[]),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, payment_status, COUNT(*)::int AS cnt FROM enrollments GROUP BY status, payment_status`),
                [] as any[]),
        ]);
        const cohortCounts = (cohorts as any[]).reduce((a: any, r: any) => { a[r.status] = r.cnt; return a; }, {});
        const enrolled = (enrollments as any[]).reduce((sum: number, r: any) => sum + (r.cnt || 0), 0);
        const paid = (enrollments as any[]).filter(r => r.payment_status === 'paid').reduce((s: number, r: any) => s + r.cnt, 0);
        return {
            courses: courses[0]?.cnt || 0,
            cohortsOpen: cohortCounts.open || 0,
            cohortsFull: cohortCounts.full || 0,
            cohortsCancelled: cohortCounts.cancelled || 0,
            cohortsFinished: cohortCounts.finished || 0,
            enrollmentsTotal: enrolled,
            enrollmentsPaid: paid,
            paymentRatePct: enrolled > 0 ? Math.round((paid / enrolled) * 100) : 0,
        };
    },

    seguros: async (prisma, schema) => {
        const [plans, quotes, policies, claims] = await Promise.all([
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM insurance_plans WHERE is_active = true`),
                [{ cnt: 0 }] as any),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM insurance_quotes GROUP BY status`),
                [] as any[]),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt, COALESCE(SUM(monthly_premium), 0)::numeric AS mrr
                 FROM insurance_policies GROUP BY status`),
                [] as any[]),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM insurance_claims GROUP BY status`),
                [] as any[]),
        ]);
        const quoteCounts = (quotes as any[]).reduce((a: any, r: any) => { a[r.status] = r.cnt; return a; }, {});
        const policyData = (policies as any[]).reduce((a: any, r: any) => {
            a.byStatus[r.status] = r.cnt;
            if (r.status === 'active') a.mrr = Number(r.mrr || 0);
            return a;
        }, { byStatus: {}, mrr: 0 });
        const claimCounts = (claims as any[]).reduce((a: any, r: any) => { a[r.status] = r.cnt; return a; }, {});
        return {
            plans: plans[0]?.cnt || 0,
            quotesActive: (quoteCounts.sent || 0) + (quoteCounts.draft || 0),
            quotesAccepted: quoteCounts.accepted || 0,
            policiesActive: policyData.byStatus.active || 0,
            policiesSuspended: policyData.byStatus.suspended || 0,
            mrr: policyData.mrr,
            claimsSubmitted: claimCounts.submitted || 0,
            claimsApproved: claimCounts.approved || 0,
            claimsPaid: claimCounts.paid || 0,
        };
    },

    veterinaria: async (prisma, schema) => {
        const [pets, vacUpcoming, vacOverdue] = await Promise.all([
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM pets WHERE is_active = true`),
                [{ cnt: 0 }] as any),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM pet_vaccinations
                 WHERE next_due_at IS NOT NULL AND next_due_at >= CURRENT_DATE AND next_due_at <= CURRENT_DATE + INTERVAL '30 days'`),
                [{ cnt: 0 }] as any),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM pet_vaccinations
                 WHERE next_due_at IS NOT NULL AND next_due_at < CURRENT_DATE`),
                [{ cnt: 0 }] as any),
        ]);
        return {
            pets: pets[0]?.cnt || 0,
            upcomingVaccinations: vacUpcoming[0]?.cnt || 0,
            overdueVaccinations: vacOverdue[0]?.cnt || 0,
        };
    },

    inmobiliaria: async (prisma, schema) => {
        const [listings] = await Promise.all([
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT transaction_type, status, COUNT(*)::int AS cnt, COALESCE(AVG(price), 0)::numeric AS avg_price
                 FROM real_estate_listings
                 WHERE is_active = true
                   AND (status NOT IN ('sold', 'rented')
                        OR updated_at >= DATE_TRUNC('month', CURRENT_DATE))
                 GROUP BY transaction_type, status`),
                [] as any[]),
        ]);
        const buckets: any = { sale: { available: 0, sold: 0, avgPrice: 0 }, rent: { available: 0, rented: 0, avgPrice: 0 } };
        for (const r of listings as any[]) {
            const tt = r.transaction_type;
            if (!buckets[tt]) continue;
            buckets[tt][r.status === 'sold' ? 'sold' : r.status === 'rented' ? 'rented' : 'available'] = r.cnt;
            if (r.status === 'available') buckets[tt].avgPrice = Number(r.avg_price || 0);
        }
        return {
            listingsForSale: buckets.sale.available,
            listingsForRent: buckets.rent.available,
            soldThisMonth: buckets.sale.sold,
            rentedThisMonth: buckets.rent.rented,
            avgSalePrice: buckets.sale.avgPrice,
            avgRentPrice: buckets.rent.avgPrice,
        };
    },

    turismo: async (prisma, schema) => {
        const [packages, bookings, properties] = await Promise.all([
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM tour_packages WHERE is_active = true`),
                [{ cnt: 0 }] as any),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt, COALESCE(SUM(total_price), 0)::numeric AS gmv
                 FROM tour_bookings
                 WHERE created_at >= NOW() - INTERVAL '30 days'
                   AND status <> 'cancelled'
                 GROUP BY status`),
                [] as any[]),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM properties WHERE is_active = true`),
                [{ cnt: 0 }] as any),
        ]);
        const bookingsCounts = (bookings as any[]).reduce((a: any, r: any) => {
            a.byStatus[r.status] = r.cnt;
            a.totalGmv += Number(r.gmv || 0);
            return a;
        }, { byStatus: {}, totalGmv: 0 });
        return {
            tourPackages: packages[0]?.cnt || 0,
            properties: properties[0]?.cnt || 0,
            bookingsConfirmed30d: bookingsCounts.byStatus.confirmed || 0,
            bookingsReserved30d: bookingsCounts.byStatus.reserved || 0,
            gmv30d: bookingsCounts.totalGmv,
        };
    },

    servicios_hogar: async (prisma, schema) => {
        const [requests] = await Promise.all([
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT urgency, status, COUNT(*)::int AS cnt FROM service_requests
                 WHERE created_at >= NOW() - INTERVAL '30 days' GROUP BY urgency, status`),
                [] as any[]),
        ]);
        const r = requests as any[];
        const total = r.reduce((s, x) => s + x.cnt, 0);
        const emergencias = r.filter(x => x.urgency === 'emergencia').reduce((s, x) => s + x.cnt, 0);
        const completed = r.filter(x => x.status === 'completed').reduce((s, x) => s + x.cnt, 0);
        const pending = r.filter(x => x.status === 'pending').reduce((s, x) => s + x.cnt, 0);
        return {
            requests30d: total,
            emergencias30d: emergencias,
            pending,
            completed,
            completionRatePct: total > 0 ? Math.round((completed / total) * 100) : 0,
        };
    },

    salud: async (prisma, schema) => {
        const [treatments, sessions7d] = await Promise.all([
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM treatment_plans GROUP BY status`),
                [] as any[]),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM treatment_sessions
                 WHERE scheduled_at >= NOW() - INTERVAL '7 days' GROUP BY status`),
                [] as any[]),
        ]);
        const tCounts = (treatments as any[]).reduce((a: any, r: any) => { a[r.status] = r.cnt; return a; }, {});
        const sCounts = (sessions7d as any[]).reduce((a: any, r: any) => { a[r.status] = r.cnt; return a; }, {});
        return {
            treatmentsActive: tCounts.active || 0,
            treatmentsCompleted: tCounts.completed || 0,
            sessionsCompletedWeek: sCounts.completed || 0,
            sessionsScheduledWeek: sCounts.scheduled || 0,
        };
    },

    fotografia: async (prisma, schema) => {
        const [byStatus, last30d, deliveryDue] = await Promise.all([
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM photo_sessions GROUP BY status`),
                [] as any[]),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(price), 0)::numeric AS revenue
                 FROM photo_sessions WHERE created_at >= NOW() - INTERVAL '30 days'`),
                [{ cnt: 0, revenue: 0 }] as any),
            requiredQuery(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM photo_sessions
                 WHERE status IN ('scheduled', 'in_progress')
                   AND delivery_due_at IS NOT NULL
                   AND delivery_due_at < CURRENT_DATE + INTERVAL '7 days'`),
                [{ cnt: 0 }] as any),
        ]);
        const counts = (byStatus as any[]).reduce((a: any, r: any) => { a[r.status] = r.cnt; return a; }, {});
        return {
            sessionsScheduled: counts.scheduled || 0,
            sessionsInProgress: counts.in_progress || 0,
            sessionsDelivered: counts.delivered || 0,
            sessions30d: last30d[0]?.cnt || 0,
            revenue30d: Number(last30d[0]?.revenue || 0),
            deliveriesDue7d: deliveryDue[0]?.cnt || 0,
        };
    },
};

/**
 * Sum the per-tenant stats into a platform-wide rollup for the
 * industry. Each industry has its own shape so we map by hand.
 */
function aggregateIndustryTotals(industry: string, tenantsData: any[]): Record<string, any> | null {
    const stats = tenantsData.map(t => t.stats).filter(Boolean) as Record<string, any>[];
    if (!stats.length) return null;
    const sum = (key: string) => stats.reduce((s, row) => s + (Number(row[key]) || 0), 0);
    const avgRate = (key: string) => {
        const vals = stats.map(s => Number(s[key]) || 0).filter(v => v > 0);
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    };
    const ratioPct = (numeratorKey: string, denominatorKeys: string | string[]) => {
        const keys = Array.isArray(denominatorKeys) ? denominatorKeys : [denominatorKeys];
        const denominator = keys.reduce((total, key) => total + sum(key), 0);
        return denominator > 0 ? Math.round((sum(numeratorKey) / denominator) * 100) : 0;
    };
    const ratioAmount = (amountKey: string, countKey: string) => {
        const count = sum(countKey);
        return count > 0 ? Math.round((sum(amountKey) / count) * 100) / 100 : 0;
    };

    switch (industry) {
        case 'moda_belleza': return {
            activeServices: sum('activeServices'),
            appointments30d: sum('appointments30d'),
            completedAppointments30d: sum('completedAppointments30d'),
            noShows30d: sum('noShows30d'),
            appointmentsNext7d: sum('appointmentsNext7d'),
            uniqueCustomers30d: sum('uniqueCustomers30d'),
            repeatCustomers30d: sum('repeatCustomers30d'),
            repeatCustomerRatePct: ratioPct('repeatCustomers30d', 'uniqueCustomers30d'),
        };
        case 'automotriz': return {
            vehiclesTotal: sum('vehiclesTotal'),
            vehiclesAvailable: sum('vehiclesAvailable'),
            vehiclesReserved: sum('vehiclesReserved'),
            vehiclesMaintenance: sum('vehiclesMaintenance'),
            vehiclesSoldThisMonth: sum('vehiclesSoldThisMonth'),
            soldRevenueCentsThisMonth: sum('soldRevenueCentsThisMonth'),
            testDrivesThisMonth: sum('testDrivesThisMonth'),
            testDrivesNext7d: sum('testDrivesNext7d'),
        };
        case 'finanzas': return {
            applicationsOpen: sum('applicationsOpen'),
            applications30d: sum('applications30d'),
            applicationsApproved30d: sum('applicationsApproved30d'),
            applicationsRejected30d: sum('applicationsRejected30d'),
            approvalRatePct: ratioPct('applicationsApproved30d', [
                'applicationsApproved30d',
                'applicationsRejected30d',
            ]),
            openEstimatedValue: sum('openEstimatedValue'),
            consultationsNext7d: sum('consultationsNext7d'),
        };
        case 'servicios_profesionales': return {
            openDeals: sum('openDeals'),
            wonDeals30d: sum('wonDeals30d'),
            lostDeals30d: sum('lostDeals30d'),
            winRate30d: ratioPct('wonDeals30d', ['wonDeals30d', 'lostDeals30d']),
            pipelineValue: sum('pipelineValue'),
            weightedPipelineValue: sum('weightedPipelineValue'),
            consultationsNext7d: sum('consultationsNext7d'),
            consultationsCompleted30d: sum('consultationsCompleted30d'),
        };
        case 'retail': return {
            productsTotal: sum('productsTotal'),
            productsAvailable: sum('productsAvailable'),
            productsOutOfStock: sum('productsOutOfStock'),
            stockUnits: sum('stockUnits'),
            orders30d: sum('orders30d'),
            paidOrders30d: sum('paidOrders30d'),
            pendingOrders30d: sum('pendingOrders30d'),
            gmv30d: sum('gmv30d'),
            averageOrderValue30d: ratioAmount('gmv30d', 'orders30d'),
        };
        case 'technology': return {
            companies: sum('companies'),
            openDeals: sum('openDeals'),
            wonDeals30d: sum('wonDeals30d'),
            lostDeals30d: sum('lostDeals30d'),
            winRate30d: ratioPct('wonDeals30d', ['wonDeals30d', 'lostDeals30d']),
            pipelineValue: sum('pipelineValue'),
            weightedPipelineValue: sum('weightedPipelineValue'),
            demosNext7d: sum('demosNext7d'),
            avgSalesCycleDays30d: avgRate('avgSalesCycleDays30d'),
        };
        case 'pet_services': return {
            pets: sum('pets'),
            activeServices: sum('activeServices'),
            bookings30d: sum('bookings30d'),
            completedBookings30d: sum('completedBookings30d'),
            noShows30d: sum('noShows30d'),
            bookingsNext7d: sum('bookingsNext7d'),
            petsServed30d: sum('petsServed30d'),
        };
        case 'otro': return {
            contactsTotal: sum('contactsTotal'),
            newContacts30d: sum('newContacts30d'),
            conversations30d: sum('conversations30d'),
            openDeals: sum('openDeals'),
            pipelineValue: sum('pipelineValue'),
            catalogProducts: sum('catalogProducts'),
            orders30d: sum('orders30d'),
            gmv30d: sum('gmv30d'),
        };
        case 'restaurantes': return {
            menuItems: sum('menuItems'),
            ordersTotal: sum('ordersTotal'),
            gmvTotal: sum('gmvTotal'),
            ordersWeek: sum('ordersWeek'),
            gmvWeek: sum('gmvWeek'),
        };
        case 'gimnasios': return {
            membersActive: sum('membersActive'),
            membersFrozen: sum('membersFrozen'),
            classesNext7d: sum('classesNext7d'),
            checkInsWeek: sum('checkInsWeek'),
            avgFillRatePct: avgRate('classFillRatePct'),
        };
        case 'education': return {
            courses: sum('courses'),
            cohortsOpen: sum('cohortsOpen'),
            enrollmentsTotal: sum('enrollmentsTotal'),
            enrollmentsPaid: sum('enrollmentsPaid'),
            avgPaymentRatePct: avgRate('paymentRatePct'),
        };
        case 'seguros': return {
            plansCount: sum('plans'),
            quotesActive: sum('quotesActive'),
            policiesActive: sum('policiesActive'),
            mrr: sum('mrr'),
            claimsOpen: sum('claimsSubmitted'),
        };
        case 'veterinaria': return {
            pets: sum('pets'),
            upcomingVaccinations: sum('upcomingVaccinations'),
            overdueVaccinations: sum('overdueVaccinations'),
        };
        case 'inmobiliaria': return {
            listingsForSale: sum('listingsForSale'),
            listingsForRent: sum('listingsForRent'),
            soldThisMonth: sum('soldThisMonth'),
            rentedThisMonth: sum('rentedThisMonth'),
        };
        case 'turismo': return {
            tourPackages: sum('tourPackages'),
            properties: sum('properties'),
            bookingsConfirmed30d: sum('bookingsConfirmed30d'),
            gmv30d: sum('gmv30d'),
        };
        case 'servicios_hogar': return {
            requests30d: sum('requests30d'),
            emergencias30d: sum('emergencias30d'),
            pending: sum('pending'),
            avgCompletionRatePct: avgRate('completionRatePct'),
        };
        case 'salud': return {
            treatmentsActive: sum('treatmentsActive'),
            treatmentsCompleted: sum('treatmentsCompleted'),
            sessionsCompletedWeek: sum('sessionsCompletedWeek'),
        };
        case 'fotografia': return {
            sessionsScheduled: sum('sessionsScheduled'),
            sessionsInProgress: sum('sessionsInProgress'),
            sessionsDelivered: sum('sessionsDelivered'),
            sessions30d: sum('sessions30d'),
            revenue30d: sum('revenue30d'),
            deliveriesDue7d: sum('deliveriesDue7d'),
        };
        default: return null;
    }
}

/** Pick the headline metric per vertical for ranking tenants. */
function primaryMetricValue(industry: string, stats: Record<string, any>): number {
    switch (industry) {
        case 'moda_belleza': return Number(stats.appointments30d || 0);
        case 'automotriz': return Number(stats.vehiclesAvailable || 0);
        case 'finanzas': return Number(stats.applicationsOpen || 0);
        case 'servicios_profesionales': return Number(stats.openDeals || 0);
        case 'retail': return Number(stats.orders30d || 0);
        case 'technology': return Number(stats.openDeals || 0);
        case 'pet_services': return Number(stats.bookings30d || 0);
        case 'otro': return Number(stats.conversations30d || 0);
        case 'restaurantes': return Number(stats.ordersWeek || 0);
        case 'gimnasios': return Number(stats.membersActive || 0);
        case 'education': return Number(stats.enrollmentsTotal || 0);
        case 'seguros': return Number(stats.policiesActive || 0);
        case 'veterinaria': return Number(stats.pets || 0);
        case 'inmobiliaria': return Number(stats.listingsForSale || 0) + Number(stats.listingsForRent || 0);
        case 'turismo': return Number(stats.bookingsConfirmed30d || 0);
        case 'servicios_hogar': return Number(stats.requests30d || 0);
        case 'salud': return Number(stats.treatmentsActive || 0);
        case 'fotografia': return Number(stats.sessions30d || 0);
        default: return 0;
    }
}
