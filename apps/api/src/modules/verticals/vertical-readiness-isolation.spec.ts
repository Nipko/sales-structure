import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { EffectiveCapabilityService } from '../conversations/effective-capability.service';
import { VerticalReadinessService } from './vertical-readiness.service';

describe('readiness isolation at the capability reader', () => {
    const make = () => {
        const prisma = { executeInTenantSchema: jest.fn(async () => [{ total: 0 }]) };
        const redis = { getJson: jest.fn(async () => ({ checks: [{ key: 'catalog_items', count: 20, satisfied: true }], unmet: [], degraded: false })), setJson: jest.fn() };
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
        expect(redis.getJson).toHaveBeenCalledWith('readiness:tenant-id:tenant_source:catalog_items');
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
