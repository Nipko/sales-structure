import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

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
            activationGaps: gapsResult,
        };

        await this.redis.setJson(cacheKey, result, this.OVERVIEW_TTL);
        return result;
    }

    /**
     * For each vertical with a domain-specific table, count tenants who
     * have zero rows in that table (a strong signal that they signed up
     * but never finished setup). Used by ops to nudge stuck tenants.
     */
    private async detectActivationGaps(tenants: any[]): Promise<Array<{
        industry: string;
        tenantId: string;
        tenantName: string;
        missing: string;
    }>> {
        const gaps: any[] = [];
        // missing key matches i18n keys on the dashboard (gaps.missingKeys.*)
        const checks: Record<string, { table: string; missing: string; activeFilter?: string }> = {
            restaurantes: { table: 'menu_items', missing: 'menu_items', activeFilter: 'is_active = true' },
            gimnasios: { table: 'membership_plans', missing: 'membership_plans', activeFilter: 'is_active = true' },
            education: { table: 'courses', missing: 'courses', activeFilter: 'is_active = true' },
            seguros: { table: 'insurance_plans', missing: 'insurance_plans', activeFilter: 'is_active = true' },
            inmobiliaria: { table: 'real_estate_listings', missing: 'listings', activeFilter: 'is_active = true' },
            turismo: { table: 'tour_packages', missing: 'properties', activeFilter: 'is_active = true' },
            servicios_hogar: { table: 'services', missing: 'services', activeFilter: 'is_active = true' },
            veterinaria: { table: 'pets', missing: 'pets', activeFilter: 'is_active = true' },
            pet_services: { table: 'pets', missing: 'pets', activeFilter: 'is_active = true' },
            fotografia: { table: 'photo_sessions', missing: 'photo_sessions' },
        };

        for (const t of tenants) {
            const check = checks[t.industry];
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
                        missing: check.missing,
                    });
                }
            } catch {
                // Schema probably hasn't been migrated for this vertical yet
            }
        }
        return gaps.slice(0, 50);
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
                const stats = aggregator
                    ? await aggregator(this.prisma, t.schemaName).catch(() => null)
                    : null;
                return {
                    tenantId: t.id,
                    tenantName: t.name,
                    plan: t.plan,
                    createdAt: t.createdAt,
                    firstMessageAt: t.firstMessageAt,
                    stats,
                };
            }),
        );

        // Aggregate platform totals for this industry
        const hasAggregator = !!INDUSTRY_AGGREGATORS[industry];
        const totals = hasAggregator ? aggregateIndustryTotals(industry, tenantsData) : null;

        const result = {
            industry,
            generatedAt: new Date().toISOString(),
            tenantCount: tenants.length,
            totals,
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
        const stats = aggregator
            ? await aggregator(this.prisma, tenant.schemaName).catch(() => null)
            : null;

        const result = {
            tenantId,
            industry,
            subType: (tenant.settings as any)?.subType || null,
            stats,
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

const INDUSTRY_AGGREGATORS: Record<string, AggregatorFn> = {
    restaurantes: async (prisma, schema) => {
        const safe = async <T>(q: () => Promise<T>, fallback: T): Promise<T> => {
            try { return await q(); } catch { return fallback; }
        };
        const [items, ordersAll, ordersWeek, promotions, kitchenStates] = await Promise.all([
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM menu_items WHERE is_active = true`),
                [{ cnt: 0 }] as any),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(total), 0)::numeric AS gmv FROM food_orders`),
                [{ cnt: 0, gmv: 0 }] as any),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(total), 0)::numeric AS gmv FROM food_orders WHERE created_at >= NOW() - INTERVAL '7 days'`),
                [{ cnt: 0, gmv: 0 }] as any),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM menu_promotions WHERE is_active = true AND (valid_to IS NULL OR valid_to >= NOW())`),
                [{ cnt: 0 }] as any),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM food_orders WHERE status NOT IN ('completed','cancelled') GROUP BY status`),
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
        const safe = async <T>(q: () => Promise<T>, fallback: T): Promise<T> => {
            try { return await q(); } catch { return fallback; }
        };
        const [plans, members, classesUpcoming, checkIns7d] = await Promise.all([
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM membership_plans WHERE is_active = true`),
                [{ cnt: 0 }] as any),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM members GROUP BY status`),
                [] as any[]),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(max_capacity - available_spots), 0)::int AS booked, COALESCE(SUM(max_capacity), 0)::int AS capacity
                 FROM fitness_classes
                 WHERE is_cancelled = false AND scheduled_at >= NOW() AND scheduled_at <= NOW() + INTERVAL '7 days'`),
                [{ cnt: 0, booked: 0, capacity: 0 }] as any),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
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
        const safe = async <T>(q: () => Promise<T>, fallback: T): Promise<T> => {
            try { return await q(); } catch { return fallback; }
        };
        const [courses, cohorts, enrollments] = await Promise.all([
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM courses WHERE is_active = true`),
                [{ cnt: 0 }] as any),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM course_cohorts GROUP BY status`),
                [] as any[]),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
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
        const safe = async <T>(q: () => Promise<T>, fallback: T): Promise<T> => {
            try { return await q(); } catch { return fallback; }
        };
        const [plans, quotes, policies, claims] = await Promise.all([
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM insurance_plans WHERE is_active = true`),
                [{ cnt: 0 }] as any),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM insurance_quotes GROUP BY status`),
                [] as any[]),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt, COALESCE(SUM(monthly_premium), 0)::numeric AS mrr
                 FROM insurance_policies GROUP BY status`),
                [] as any[]),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
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
        const safe = async <T>(q: () => Promise<T>, fallback: T): Promise<T> => {
            try { return await q(); } catch { return fallback; }
        };
        const [pets, vacUpcoming, vacOverdue] = await Promise.all([
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM pets WHERE is_active = true`),
                [{ cnt: 0 }] as any),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM pet_vaccinations
                 WHERE next_due_at IS NOT NULL AND next_due_at >= CURRENT_DATE AND next_due_at <= CURRENT_DATE + INTERVAL '30 days'`),
                [{ cnt: 0 }] as any),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
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
        const safe = async <T>(q: () => Promise<T>, fallback: T): Promise<T> => {
            try { return await q(); } catch { return fallback; }
        };
        const [listings] = await Promise.all([
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT transaction_type, status, COUNT(*)::int AS cnt, COALESCE(AVG(price), 0)::numeric AS avg_price
                 FROM real_estate_listings WHERE is_active = true GROUP BY transaction_type, status`),
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
        const safe = async <T>(q: () => Promise<T>, fallback: T): Promise<T> => {
            try { return await q(); } catch { return fallback; }
        };
        const [packages, bookings, properties] = await Promise.all([
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt FROM tour_packages WHERE is_active = true`),
                [{ cnt: 0 }] as any),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt, COALESCE(SUM(total_price), 0)::numeric AS gmv
                 FROM tour_bookings WHERE created_at >= NOW() - INTERVAL '30 days' GROUP BY status`),
                [] as any[]),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
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
        const safe = async <T>(q: () => Promise<T>, fallback: T): Promise<T> => {
            try { return await q(); } catch { return fallback; }
        };
        const [requests] = await Promise.all([
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
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
        const safe = async <T>(q: () => Promise<T>, fallback: T): Promise<T> => {
            try { return await q(); } catch { return fallback; }
        };
        const [treatments, sessions7d] = await Promise.all([
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM treatment_plans GROUP BY status`),
                [] as any[]),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
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
        const safe = async <T>(q: () => Promise<T>, fallback: T): Promise<T> => {
            try { return await q(); } catch { return fallback; }
        };
        const [byStatus, last30d, deliveryDue] = await Promise.all([
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*)::int AS cnt FROM photo_sessions GROUP BY status`),
                [] as any[]),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(price), 0)::numeric AS revenue
                 FROM photo_sessions WHERE created_at >= NOW() - INTERVAL '30 days'`),
                [{ cnt: 0, revenue: 0 }] as any),
            safe(() => prisma.executeInTenantSchema<any[]>(schema,
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

    switch (industry) {
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
