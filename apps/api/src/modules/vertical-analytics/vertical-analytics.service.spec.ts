import { VerticalAnalyticsService } from './vertical-analytics.service';
import { VERTICAL_ANALYTICS_FIXTURES, VerticalAnalyticsFixture } from './vertical-analytics.fixtures';

describe('VerticalAnalyticsService semantic aggregators', () => {
    const schemaName = 'tenant_metrics';

    function createHarness(
        industry: string,
        executeInTenantSchema: (schema: string, sql: string, params?: any[]) => Promise<any[]>,
        tenants: any[] = [{
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Tenant Metrics',
            slug: 'tenant-metrics',
            schemaName,
            plan: 'pro',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            firstMessageAt: new Date('2026-01-02T00:00:00.000Z'),
        }],
    ) {
        const prisma = {
            tenant: {
                findMany: jest.fn().mockResolvedValue(tenants),
                findUnique: jest.fn(),
            },
            executeInTenantSchema: jest.fn(executeInTenantSchema),
        };
        const redis = {
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn().mockResolvedValue(undefined),
        };
        return {
            service: new VerticalAnalyticsService(prisma as any, redis as any),
            prisma,
            redis,
            industry,
        };
    }

    function fixtureExecutor(fixture: VerticalAnalyticsFixture) {
        return async (_schema: string, sql: string): Promise<any[]> => {
            const match = fixture.queryRows.find((entry) => sql.includes(entry.includes));
            if (!match) throw new Error(`No fixture for ${fixture.industry} SQL: ${sql}`);
            return match.rows;
        };
    }

    it.each(VERTICAL_ANALYTICS_FIXTURES)(
        'computes $industry metrics from its real persisted entities',
        async (fixture) => {
            const harness = createHarness(fixture.industry, fixtureExecutor(fixture));

            const result = await harness.service.getIndustryDrilldown(fixture.industry, true);

            expect(result.totalsStatus).toBe('ok');
            expect(result.queryErrorCount).toBe(0);
            expect(result.tenants).toHaveLength(1);
            expect(result.tenants[0]).toMatchObject({
                statsStatus: 'ok',
                statsError: null,
                stats: fixture.expectedStats,
            });
        },
    );

    it('distinguishes a successful empty dataset from a failed query', async () => {
        const noData = createHarness('retail', async () => []);
        const emptyResult = await noData.service.getIndustryDrilldown('retail', true);

        expect(emptyResult.totalsStatus).toBe('no_data');
        expect(emptyResult.queryErrorCount).toBe(0);
        expect(emptyResult.tenants[0].statsStatus).toBe('no_data');
        expect(emptyResult.tenants[0].stats).toEqual(expect.objectContaining({
            productsTotal: 0,
            orders30d: 0,
            gmv30d: 0,
        }));
        expect(emptyResult.tenants[0].statsError).toBeNull();

        const queryError: any = new Error('relation "products" does not exist');
        queryError.code = '42P01';
        const failed = createHarness('retail', async () => { throw queryError; });
        const failedResult = await failed.service.getIndustryDrilldown('retail', true);

        expect(failedResult.totalsStatus).toBe('query_error');
        expect(failedResult.queryErrorCount).toBe(1);
        expect(failedResult.totals).toBeNull();
        expect(failedResult.tenants[0]).toMatchObject({
            stats: null,
            statsStatus: 'query_error',
            statsError: {
                code: '42P01',
                message: 'relation "products" does not exist',
            },
        });
    });

    it('reports partial_error while retaining totals from successful tenants', async () => {
        const fixture = VERTICAL_ANALYTICS_FIXTURES.find((entry) => entry.industry === 'retail')!;
        const tenants = [
            {
                id: '11111111-1111-4111-8111-111111111111',
                name: 'Healthy Retail',
                slug: 'healthy-retail',
                schemaName: 'tenant_healthy',
                plan: 'pro',
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                firstMessageAt: new Date('2026-01-02T00:00:00.000Z'),
            },
            {
                id: '22222222-2222-4222-8222-222222222222',
                name: 'Broken Retail',
                slug: 'broken-retail',
                schemaName: 'tenant_broken',
                plan: 'starter',
                createdAt: new Date('2026-01-03T00:00:00.000Z'),
                firstMessageAt: null,
            },
        ];
        const execute = async (schema: string, sql: string): Promise<any[]> => {
            if (schema === 'tenant_broken') throw Object.assign(new Error('schema unavailable'), { code: '3F000' });
            return fixtureExecutor(fixture)(schema, sql);
        };
        const harness = createHarness('retail', execute, tenants);

        const result = await harness.service.getIndustryDrilldown('retail', true);

        expect(result.totalsStatus).toBe('partial_error');
        expect(result.queryErrorCount).toBe(1);
        expect(result.totals).toMatchObject({ orders30d: 20, gmv30d: 3000000 });
        expect(result.tenants.find((tenant: any) => tenant.tenantName === 'Broken Retail'))
            .toMatchObject({ statsStatus: 'query_error', stats: null });
    });

    it('counts only non-terminal kitchen orders as active work', async () => {
        let kitchenSql = '';
        const harness = createHarness('restaurantes', async (_schema, sql) => {
            if (sql.includes('FROM menu_items')) return [{ cnt: 4 }];
            if (sql.includes('FROM menu_promotions')) return [{ cnt: 1 }];
            if (sql.includes('GROUP BY status')) {
                kitchenSql = sql;
                return [{ status: 'received', cnt: 2 }, { status: 'preparing', cnt: 3 }];
            }
            if (sql.includes("INTERVAL '7 days'")) return [{ cnt: 5, gmv: 500 }];
            if (sql.includes('FROM food_orders')) return [{ cnt: 20, gmv: 2000 }];
            throw new Error(`Unexpected SQL: ${sql}`);
        });

        const result = await harness.service.getIndustryDrilldown('restaurantes', true);

        expect(result.tenants[0].stats.kitchenInProgress).toBe(5);
        expect(kitchenSql).toContain("status NOT IN ('delivered', 'cancelled')");
        expect(kitchenSql).not.toContain("'completed'");
    });

    it('filters monthly real-estate outcomes by the persisted status timestamp', async () => {
        let listingsSql = '';
        const harness = createHarness('inmobiliaria', async (_schema, sql) => {
            listingsSql = sql;
            return [
                { transaction_type: 'sale', status: 'available', cnt: 7, avg_price: 300000000 },
                { transaction_type: 'sale', status: 'sold', cnt: 2, avg_price: 310000000 },
                { transaction_type: 'rent', status: 'available', cnt: 4, avg_price: 2500000 },
                { transaction_type: 'rent', status: 'rented', cnt: 1, avg_price: 2600000 },
            ];
        });

        const result = await harness.service.getIndustryDrilldown('inmobiliaria', true);

        expect(result.tenants[0].stats).toMatchObject({ soldThisMonth: 2, rentedThisMonth: 1 });
        expect(listingsSql).toContain("status NOT IN ('sold', 'rented')");
        expect(listingsSql).toContain("updated_at >= DATE_TRUNC('month', CURRENT_DATE)");
    });

    it('excludes cancelled tour bookings from both counts and GMV', async () => {
        let bookingsSql = '';
        const harness = createHarness('turismo', async (_schema, sql) => {
            if (sql.includes('FROM tour_packages')) return [{ cnt: 3 }];
            if (sql.includes('FROM properties')) return [{ cnt: 2 }];
            if (sql.includes('FROM tour_bookings')) {
                bookingsSql = sql;
                return [
                    { status: 'confirmed', cnt: 2, gmv: 600 },
                    { status: 'reserved', cnt: 1, gmv: 250 },
                ];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });

        const result = await harness.service.getIndustryDrilldown('turismo', true);

        expect(result.tenants[0].stats).toMatchObject({
            bookingsConfirmed30d: 2,
            bookingsReserved30d: 1,
            gmv30d: 850,
        });
        expect(bookingsSql).toContain("status <> 'cancelled'");
    });
});
