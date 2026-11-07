import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STATIC_TOOL_NAMES } from '../conversations/tool-policy-registry';
import { ToolObservabilityController } from './tool-observability.controller';
import {
    ToolObservabilityService,
    buildTenantToolRow,
    buildToolCatalog,
    mapWithConcurrency,
    parseUsageQuery,
    quoteIdent,
    summariseUsage,
} from './tool-observability.service';

const T1 = '11111111-2222-4333-8444-555555555555';
const T2 = '22222222-2222-4333-8444-555555555555';
const T3 = '33333333-2222-4333-8444-555555555555';

describe('ToolObservabilityController', () => {
    it('is a guarded, super-admin-only platform surface under admin/tools', () => {
        expect(Reflect.getMetadata(ROLES_KEY, ToolObservabilityController)).toEqual(['super_admin']);
        expect(Reflect.getMetadata(GUARDS_METADATA, ToolObservabilityController)).toHaveLength(2);
        expect(Reflect.getMetadata(PATH_METADATA, ToolObservabilityController)).toBe('admin/tools');
    });

    it('validates usage filters before touching the database', async () => {
        const service = { getUsage: jest.fn().mockResolvedValue({}) } as any;
        const controller = new ToolObservabilityController(service);
        await expect(controller.getUsage('14')).rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.getUsage('7', 'nope')).rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.getUsage('7', undefined, "x'; drop")).rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.getUsage('7', undefined, undefined, 'prod')).rejects.toBeInstanceOf(BadRequestException);
        expect(service.getUsage).not.toHaveBeenCalled();
        await controller.getUsage(undefined, T1, 'search_products', 'all');
        expect(service.getUsage).toHaveBeenCalledWith({ days: 30, tenantId: T1, tool: 'search_products', mode: null });
    });
});

describe('parseUsageQuery', () => {
    it('defaults to 30 days of live usage', () => {
        expect(parseUsageQuery({})).toEqual({ days: 30, tenantId: null, tool: null, mode: 'live' });
        expect(parseUsageQuery({ days: '90', mode: 'agent_test' })).toEqual({ days: 90, tenantId: null, tool: null, mode: 'agent_test' });
    });
});

describe('buildToolCatalog', () => {
    const catalog = buildToolCatalog();
    const byTool = new Map(catalog.entries.map(entry => [entry.tool, entry]));

    it('covers every static tool exactly once, with families that add up', () => {
        expect(catalog.entries.map(entry => entry.tool).sort()).toEqual([...STATIC_TOOL_NAMES].sort());
        expect(catalog.families.reduce((sum, family) => sum + family.tools, 0)).toBe(catalog.entries.length);
        for (const family of catalog.families) expect(family.reads + family.writes).toBe(family.tools);
    });

    it('enriches tools with description, access, family and vertical profiles', () => {
        const search = byTool.get('search_products')!;
        expect(search).toEqual(expect.objectContaining({ family: 'catalog', access: 'read', verticalScoped: true, readiness: 'catalog_items' }));
        expect(search.description).toEqual(expect.any(String));
        expect(search.profiles.length).toBeGreaterThan(0);
        const create = byTool.get('create_appointment')!;
        expect(create.access).toBe('write');
        expect(create.subpermission).toEqual({ family: 'appointments', flag: 'canBook' });
        expect(create.profiles).toContain('salud/dental');
        // Las familias horizontales no dependen del subtipo.
        expect(byTool.get('get_policy')).toEqual(expect.objectContaining({ family: 'policies', verticalScoped: false, profiles: [] }));
    });

    it('marks the payment family as plan-gated and refund as never advertised', () => {
        for (const tool of ['create_payment_link', 'get_payment_status', 'refund_payment']) {
            expect(byTool.get(tool)).toEqual(expect.objectContaining({ family: 'payments', planFeature: 'customerPayments' }));
        }
        expect(byTool.get('refund_payment')!.advertised).toBe(false);
        expect(byTool.get('create_payment_link')!.advertised).toBe(true);
    });
});

describe('buildTenantToolRow', () => {
    const familyByTool = new Map(buildToolCatalog().entries.map(entry => [entry.tool, entry.family]));
    const tenant = { id: T1, name: 'Clínica', plan: 'pro', schemaName: 'tenant_clinica', industry: 'salud', settings: { subType: 'dental' } };

    it('computes enabled, used, enabled-but-unused and used-but-not-enabled from live usage only', () => {
        const row = buildTenantToolRow({
            tenant,
            agents: [
                { meta: { id: 'a1', name: 'Ana', is_active: true, version: 3 }, tools: { appointments: { enabled: true, canCancel: false }, faqs: { enabled: true }, payments: { enabled: true } } },
                { meta: { id: 'a2', name: 'Vieja', is_active: false }, tools: { catalog: { enabled: true } } },
            ],
            planFeatures: { customerPayments: false },
            usage: [
                { tenant_id: T1, tool_name: 'create_appointment', mode: 'live', calls: 5n, errors: 1n, blocked: 0n, last_at: new Date('2026-11-05T10:00:00Z') },
                { tenant_id: T1, tool_name: 'search_products', mode: 'live', calls: 2, errors: 0, blocked: 0, last_at: '2026-11-04T10:00:00Z' },
                { tenant_id: T1, tool_name: 'search_faqs', mode: 'agent_test', calls: 7, errors: 0, blocked: 0, last_at: null },
                { tenant_id: T1, tool_name: 'mcp__crm__lookup', mode: 'live', calls: 1, errors: 0, blocked: 0, last_at: null },
            ],
            familyByTool,
        });

        expect(row.subtype).toBe('dental');
        expect(row.agents).toHaveLength(1);
        expect(row.agents[0]).toEqual(expect.objectContaining({
            id: 'a1', name: 'Ana', version: 3, paymentsEnabled: true,
            enabledFamilies: expect.arrayContaining(['appointments', 'faqs']),
        }));
        expect(row.agents[0].subpermissionDenials).toEqual([
            { family: 'appointments', flag: 'canCancel', tools: ['cancel_appointment', 'reschedule_appointment'] },
        ]);
        expect(row.enabledTools).toContain('create_appointment');
        expect(row.enabledTools).toContain('search_faqs');
        expect(row.enabledTools).not.toContain('cancel_appointment');
        // El plan no incluye pagos: la configuración los pide y el plan los retira.
        expect(row.enabledTools).not.toContain('create_payment_link');
        expect(row.blockedByPlan).toEqual(expect.arrayContaining(['create_payment_link', 'get_payment_status', 'refund_payment']));
        expect(row.usedTools).toEqual(['create_appointment', 'mcp__crm__lookup', 'search_products']);
        // search_faqs sólo se usó en Agent Test: sigue contando como sin uso real.
        expect(row.enabledButUnused).toContain('search_faqs');
        expect(row.enabledButUnused).not.toContain('create_appointment');
        // search_products viene de una agente inactiva; MCP no tiene configuración contra la cual comparar.
        expect(row.usedButNotEnabled).toEqual(['search_products']);
        expect(row.nonLiveCalls).toBe(7);
        expect(row.usage[0]).toEqual({ tool: 'create_appointment', calls: 5, errors: 1, blocked: 0, lastAt: '2026-11-05T10:00:00.000Z' });
    });

    it('tolerates an unreadable agents table', () => {
        const row = buildTenantToolRow({ tenant, agents: null, agentsError: 'agents_unreadable', planFeatures: {}, usage: [], familyByTool });
        expect(row).toEqual(expect.objectContaining({ agentsError: 'agents_unreadable', agents: [], enabledTools: [], usedButNotEnabled: [] }));
    });
});

describe('ToolObservabilityService.getTenantMatrix', () => {
    function prismaMock() {
        const queries: string[] = [];
        const prisma = {
            tenant: {
                findMany: jest.fn().mockResolvedValue([
                    { id: T1, name: 'Uno', plan: 'pro', schemaName: 'tenant_uno', settings: {} },
                    { id: T2, name: 'Sin schema', plan: 'starter', schemaName: 'tenant_gone', settings: {} },
                    { id: T3, name: 'Réplica', plan: 'pro', schemaName: 'tenant_eval_0123abcd_0123456789abcdef01234567', settings: {} },
                ]),
            },
            assertTenantSchemaName: jest.fn(),
            $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
                queries.push(sql);
                if (sql.includes('information_schema.schemata')) {
                    expect(params[0]).toEqual(['tenant_uno', 'tenant_gone']);
                    return [{ schema_name: 'tenant_uno' }];
                }
                if (sql.includes('platform_tool_usage_daily')) {
                    return [{ tenant_id: T1, tool_name: 'list_services', mode: 'live', calls: 3n, errors: 0n, blocked: 0n, last_at: null }];
                }
                if (sql.includes('to_regclass')) {
                    expect(params[0]).toBe('tenant_uno');
                    return [{ ok: true }];
                }
                if (sql.includes('agent_personas')) {
                    return [{ meta: { id: 'a1', is_active: true }, tools: { appointments: { enabled: true } } }];
                }
                throw new Error(`unexpected query ${sql}`);
            }),
        };
        return { prisma, queries };
    }

    it('skips eval replicas and missing schemas, quotes the schema and resolves plan features', async () => {
        const { prisma, queries } = prismaMock();
        const throttle = { getPlanFeatures: jest.fn().mockResolvedValue({ customerPayments: true }) };
        const service = new ToolObservabilityService(prisma as any, throttle as any);

        const result = await service.getTenantMatrix();

        expect(result.usageAvailable).toBe(true);
        expect(result.skippedSchemas).toBe(1);
        expect(result.tenants).toHaveLength(1);
        expect(result.tenants[0]).toEqual(expect.objectContaining({
            tenantId: T1, planFeatures: { customerPayments: true }, usedTools: ['list_services'],
        }));
        expect(result.tenants[0].enabledTools).toContain('list_services');
        expect(queries.find(sql => sql.includes('agent_personas') && !sql.includes('to_regclass'))).toContain('FROM "tenant_uno"."agent_personas"');
        expect(throttle.getPlanFeatures).toHaveBeenCalledWith(T1);
    });

    it('reports plan features as unknown and usage as unavailable instead of failing', async () => {
        const { prisma } = prismaMock();
        const base = prisma.$queryRawUnsafe.getMockImplementation()!;
        prisma.$queryRawUnsafe.mockImplementation(async (sql: string, ...params: unknown[]) => {
            if (sql.includes('platform_tool_usage_daily')) throw new Error('relation does not exist');
            return base(sql, ...params);
        });
        const service = new ToolObservabilityService(prisma as any, { getPlanFeatures: jest.fn().mockRejectedValue(new Error('redis')) } as any);
        const result = await service.getTenantMatrix();
        expect(result.usageAvailable).toBe(false);
        expect(result.tenants[0].planFeatures).toEqual({ customerPayments: null });
    });
});

describe('ToolObservabilityService.getUsage', () => {
    it('passes filters as parameters and summarises the aggregates', async () => {
        const prisma = {
            $queryRawUnsafe: jest.fn(async (sql: string) => {
                if (sql.includes('DISTINCT ON')) return [{ tool_name: 'create_order', last_error_code: 'no_contact', last_at: new Date() }];
                if (sql.includes('GROUP BY day')) return [{ day: new Date('2026-11-05T00:00:00Z'), calls: 10n, errors: 2n, blocked: 0n }];
                if (sql.includes('GROUP BY tool_name, last_error_code')) return [{ tool_name: 'create_order', last_error_code: 'no_contact', calls: 2n, tenants: 1, last_at: null }];
                return [
                    { tool_name: 'search_products', calls: 8n, errors: 0n, blocked: 1n, pending: 0n, total_ms: 800n, max_ms: 250, lat_lt_100: 4n, lat_lt_300: 4n, lat_lt_1000: 0n, lat_lt_3000: 0n, lat_lt_10000: 0n, lat_ge_10000: 0n, last_at: new Date(), tenants: 2 },
                    { tool_name: 'create_order', calls: 2n, errors: 2n, blocked: 0n, pending: 0n, total_ms: 3000n, max_ms: 2000, lat_lt_100: 0n, lat_lt_300: 0n, lat_lt_1000: 1n, lat_lt_3000: 1n, lat_lt_10000: 0n, lat_ge_10000: 0n, last_at: new Date(), tenants: 1 },
                ];
            }),
        };
        const service = new ToolObservabilityService(prisma as any);
        const result = await service.getUsage({ days: 7, tenantId: T1, tool: null, mode: 'live' });

        for (const call of prisma.$queryRawUnsafe.mock.calls) {
            expect(call.slice(1)).toEqual([7, T1, null, 'live']);
            expect(call[0]).not.toContain(T1);
        }
        expect(result.available).toBe(true);
        expect(result.tools.map(tool => tool.tool)).toEqual(['create_order', 'search_products']);
        expect(result.tools[0]).toEqual(expect.objectContaining({ errors: 2, errorRate: 1, lastErrorCode: 'no_contact', avgMs: 1500, maxMs: 2000 }));
        expect(result.totals).toEqual(expect.objectContaining({ calls: 10, errors: 2, blocked: 1, errorRate: 0.2, maxMs: 2000, tools: 2 }));
        expect(result.totals.p95Ms).toBeGreaterThan(result.totals.p50Ms!);
        expect(result.days).toEqual([{ day: '2026-11-05', calls: 10, errors: 2, blocked: 0 }]);
        expect(result.topErrors[0]).toEqual(expect.objectContaining({ tool: 'create_order', errorCode: 'no_contact', calls: 2 }));
        expect(result.filters.mode).toBe('live');
    });

    it('returns an empty, unavailable summary when the table is missing', async () => {
        const prisma = { $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('relation does not exist')) };
        const result = await new ToolObservabilityService(prisma as any).getUsage(parseUsageQuery({ mode: 'all' }));
        expect(result).toEqual(expect.objectContaining({ available: false, tools: [], days: [], topErrors: [] }));
        expect(result.totals).toEqual(expect.objectContaining({ calls: 0, errorRate: 0, p95Ms: null }));
        expect(result.filters.mode).toBe('all');
    });
});

describe('helpers', () => {
    it('quotes identifiers like quote_ident', () => {
        expect(quoteIdent('tenant_x')).toBe('"tenant_x"');
        expect(quoteIdent('a"b')).toBe('"a""b"');
    });

    it('bounds concurrency and keeps order', async () => {
        let inFlight = 0;
        let peak = 0;
        const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async value => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise(resolve => setTimeout(resolve, 5));
            inFlight--;
            return value * 2;
        });
        expect(peak).toBe(4);
        expect(result).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
        await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
    });

    it('summarises with no rows', () => {
        const summary = summariseUsage({ query: parseUsageQuery({}), available: true, toolRows: [], errorCodeRows: [], dayRows: [], topErrorRows: [] });
        expect(summary.totals.calls).toBe(0);
        expect(summary.totals.p50Ms).toBeNull();
    });
});
