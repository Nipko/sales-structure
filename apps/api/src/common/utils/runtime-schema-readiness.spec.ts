import { QualityService } from '../../modules/quality/quality.service';
import { TraceService } from '../../modules/trace/trace.service';
import { ProceduresService } from '../../modules/procedures/procedures.service';
import { AttributionService } from '../../modules/attribution/attribution.service';
import { ReviewsService } from '../../modules/reviews/reviews.service';
import { VerticalIntegrationsService } from '../../modules/vertical-integrations/vertical-integrations.service';
import { EvalService } from '../../modules/simulation/eval.service';
import { KnowledgeService } from '../../modules/knowledge/knowledge.service';

describe('DDL failure is not schema readiness', () => {
    function fixture(prototype: object) {
        const failure = Object.assign(new Error('Raw query failed. Code: 23505. duplicate key'), {
            code: 'P2010', meta: { code: '23505' },
        });
        const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
        const service = Object.assign(Object.create(prototype), {
            prisma: {
                executeInTenantSchema: jest.fn().mockRejectedValue(failure),
                assertTenantSchemaName: jest.fn(),
            },
            redis, ensured: new Set(),
            logger: { warn: jest.fn(), debug: jest.fn() },
        });
        return { service, redis, failure };
    }

    it.each([
        ['quality', QualityService.prototype, 'ensureTables'],
        ['trace', TraceService.prototype, 'ensureTables'],
        ['procedures', ProceduresService.prototype, 'ensureTables'],
        ['attribution', AttributionService.prototype, 'ensureTables'],
        ['reviews', ReviewsService.prototype, 'ensureTables'],
        ['vertical integrations', VerticalIntegrationsService.prototype, 'ensureTables'],
        ['evaluations', EvalService.prototype, 'ensureTable'],
    ] as const)('%s propagates an incomplete setup without publishing readiness', async (_name, prototype, method) => {
        const { service, redis, failure } = fixture(prototype);
        await expect(service[method]('tenant_probe')).rejects.toBe(failure);
        expect(redis.set).not.toHaveBeenCalled();
        expect(service.ensured.size).toBe(0);
    });

    it('keeps knowledge search fallback but retries the failed schema setup', async () => {
        const { service, redis } = fixture(KnowledgeService.prototype);
        await service.ensureKbSearchVector('tenant_probe');
        expect(redis.set).not.toHaveBeenCalled();
        await service.ensureKbSearchVector('tenant_probe');
        expect(service.prisma.executeInTenantSchema).toHaveBeenCalledTimes(2);
    });
});
