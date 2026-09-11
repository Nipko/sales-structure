import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { EffectiveCapabilityService } from '../conversations/effective-capability.service';
import { VerticalReadinessService } from './vertical-readiness.service';

describe('readiness isolation at the capability reader', () => {
    const make = () => {
        const prisma = { executeInTenantSchema: jest.fn(async () => [{ total: 0 }]) };
        const redis = { get: jest.fn(async () => null), getJson: jest.fn(async () => ({ checks: [{ key: 'catalog_items', count: 20, satisfied: true }], unmet: [], degraded: false })), setJson: jest.fn() };
        return { prisma, redis, service: new VerticalReadinessService(prisma as any, redis as any) };
    };
    it.each(['tenant_source', 'tenant_eval_owned'])('reads %s directly in read-only execution despite a warm live cache', async schema => {
        const { service, prisma, redis } = make();
        const result = await service.evaluate('tenant-id', schema, ['catalog_items'], AGENT_TEST_EXECUTION_CONTEXT);
        expect(result.unmet).toEqual(['catalog_items']);
        expect(prisma.executeInTenantSchema).toHaveBeenCalledWith(schema, expect.stringContaining('FROM products'));
        expect(redis.getJson).not.toHaveBeenCalled();
        expect(redis.setJson).not.toHaveBeenCalled();
    });
    it('does not let an old namespace caller poison the live cache when context is omitted', async () => {
        const { service, redis } = make();
        await service.evaluate('tenant-id', 'tenant_eval_owned', ['catalog_items']);
        expect(redis.getJson).not.toHaveBeenCalled();
        expect(redis.setJson).not.toHaveBeenCalled();
    });
    it('retains caching scoped to the exact live schema', async () => {
        const { service, prisma, redis } = make();
        await service.evaluate('tenant-id', 'tenant_source', ['catalog_items']);
        expect(redis.getJson).toHaveBeenCalledWith('readiness:tenant-id:tenant_source:catalog_items:initial');
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
    it('propagates the execution context through the actual capability resolver', async () => {
        const readiness = { evaluate: jest.fn(async () => ({ checks: [], unmet: [], degraded: false })) };
        const throttle = { getPlanFeatures: jest.fn(async () => ({ inventory: true, catalog: true })), getTenantPlan: jest.fn(async () => 'enterprise') };
        const service = new EffectiveCapabilityService(throttle as any, readiness as any);
        await service.resolve({ tenantId: 'tenant-id', schemaName: 'tenant_eval_owned', industry: 'retail', subType: 'moda',
            toolsConfig: { catalog: { enabled: true } }, executionContext: AGENT_TEST_EXECUTION_CONTEXT });
        expect(readiness.evaluate).toHaveBeenCalledWith('tenant-id', 'tenant_eval_owned', expect.any(Array), AGENT_TEST_EXECUTION_CONTEXT);
    });
});

describe('readiness refresh after business configuration', () => {
    function fixture() {
        const cache = new Map<string, any>();
        let rows = 0;
        const prisma = { executeInTenantSchema: jest.fn(async () => [{ total: rows }]) };
        const redis = {
            get: jest.fn(async (key: string) => cache.get(key) ?? null),
            set: jest.fn(async (key: string, value: string) => { cache.set(key, value); }),
            getJson: jest.fn(async (key: string) => cache.get(key) ?? null),
            setJson: jest.fn(async (key: string, value: any) => { cache.set(key, value); }),
            del: jest.fn(async (key: string) => { cache.delete(key); }),
        };
        return { prisma, redis, service: new VerticalReadinessService(prisma as any, redis as any),
            data: (count: number) => { rows = count; } };
    }

    it('invalidates every schema and key combination for this tenant without flushing another', async () => {
        const f = fixture();
        await f.service.evaluate('one', 'tenant_one', ['catalog_items']);
        await f.service.evaluate('one', 'tenant_other_schema', ['faq_content']);
        await f.service.evaluate('two', 'tenant_two', ['catalog_items']);
        f.data(1);
        await f.service.invalidate('one');
        expect((await f.service.evaluate('one', 'tenant_one', ['catalog_items'])).unmet).toEqual([]);
        expect((await f.service.evaluate('one', 'tenant_other_schema', ['faq_content'])).unmet).toEqual([]);
        expect((await f.service.evaluate('two', 'tenant_two', ['catalog_items'])).unmet).toEqual(['catalog_items']);
    });

    it('refreshes the owner diagnosis and the subsequent live turn after data is added', async () => {
        const f = fixture();
        expect((await f.service.evaluate('one', 'tenant_one', ['catalog_items'])).unmet).toEqual(['catalog_items']);
        f.data(1);
        expect((await (f.service.evaluate as any)('one', 'tenant_one', ['catalog_items'], undefined, { refresh: true })).unmet).toEqual([]);
        const calls = f.prisma.executeInTenantSchema.mock.calls.length;
        expect((await f.service.evaluate('one', 'tenant_one', ['catalog_items'])).unmet).toEqual([]);
        expect(f.prisma.executeInTenantSchema).toHaveBeenCalledTimes(calls);
    });

    it('does not let an in-flight old count repopulate the current generation', async () => {
        const f = fixture();
        let finish!: (rows: any) => void;
        let started!: () => void;
        const querying = new Promise<void>(resolve => { started = resolve; });
        f.prisma.executeInTenantSchema.mockImplementationOnce(() => {
            started();
            return new Promise(resolve => { finish = resolve; });
        });
        const old = f.service.evaluate('one', 'tenant_one', ['catalog_items']);
        await querying;
        await f.service.invalidate('one');
        f.data(1);
        expect((await f.service.evaluate('one', 'tenant_one', ['catalog_items'])).unmet).toEqual([]);
        finish([{ total: 0 }]);
        await old;
        expect((await f.service.evaluate('one', 'tenant_one', ['catalog_items'])).unmet).toEqual([]);
    });

    it('reads the database when the cache generation cannot be read', async () => {
        const f = fixture();
        await f.service.evaluate('one', 'tenant_one', ['catalog_items']);
        f.data(1);
        f.redis.get.mockRejectedValue(new Error('cache unavailable'));
        expect((await f.service.evaluate('one', 'tenant_one', ['catalog_items'])).unmet).toEqual([]);
    });
});
