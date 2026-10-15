import { BadRequestException } from '@nestjs/common';
import { CrmController } from '../../crm.controller';
import { SegmentsService } from './segments.service';

describe('Segment filters fail closed on unsupported or malformed rules', () => {
    const tenant = '00000000-0000-4000-8000-000000000001';
    let service: SegmentsService;
    let controller: CrmController;
    let execute: jest.Mock;
    beforeEach(() => {
        // Two synthetic leads exist. A query without WHERE selects both;
        // the valid score predicate selects only one. No database is contacted.
        execute = jest.fn(async (_schema: string, sql: string) => [{ count: sql.includes(' WHERE ') ? 1 : 2 }]);
        service = Object.create(SegmentsService.prototype);
        Object.assign(service, { getTenantSchema: jest.fn().mockResolvedValue('tenant_synthetic'), prisma: { executeInTenantSchema: execute }, logger: { log: jest.fn() } });
        controller = Object.create(CrmController.prototype);
        Object.assign(controller, { segmentsService: service });
    });

    const valid = { field: 'score', operator: 'gte', value: '7' };
    const invalid = [
        ['unknown field', [{ field: 'scroe', operator: 'gte', value: '7' }]],
        ['unknown operator', [{ field: 'score', operator: 'greater_than', value: '7' }]],
        ['invalid metadata key', [{ field: 'metadata.bad-key', operator: 'eq', value: 'synthetic' }]],
        ['mixed valid and invalid rules', [valid, { field: 'unknown', operator: 'eq', value: 'synthetic' }]],
        ['non-array rules', { field: 'score', operator: 'gte', value: '7' }],
        ['null rule', [null]],
        ['missing field', [{ operator: 'eq', value: 'synthetic' }]],
    ] as const;

    it.each(invalid)('rejects %s as 400 before querying leads', async (_label, rules) => {
        await expect(controller.createSegment(tenant, { preview: true, filterRules: rules })).rejects.toBeInstanceOf(BadRequestException);
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects invalid create filters before calculating or persisting membership', async () => {
        await expect(service.createSegment(tenant, { name: 'Synthetic', filterRules: invalid[0][1] as any })).rejects.toBeInstanceOf(BadRequestException);
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects invalid update filters before changing a saved segment', async () => {
        await expect(service.updateSegment(tenant, tenant, { filterRules: invalid[1][1] as any })).rejects.toBeInstanceOf(BadRequestException);
        expect(execute).not.toHaveBeenCalled();
    });

    it('keeps an explicit empty filter as an intentional all-contact preview', async () => {
        await expect(controller.createSegment(tenant, { preview: true, filterRules: [] })).resolves.toEqual({ success: true, data: { count: 2 } });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('preserves valid numeric parameter binding', async () => {
        await expect(controller.createSegment(tenant, { preview: true, filterRules: [valid] })).resolves.toEqual({ success: true, data: { count: 1 } });
        expect(execute).toHaveBeenCalledWith('tenant_synthetic', expect.stringContaining('score >= $1::numeric'), ['7']);
    });

    it('preserves valid metadata keys and bound values', async () => {
        await expect(controller.createSegment(tenant, { preview: true, filterRules: [{ field: 'metadata.qa_interest', operator: 'eq', value: 'synthetic' }] })).resolves.toEqual({ success: true, data: { count: 1 } });
        expect(execute).toHaveBeenCalledWith('tenant_synthetic', expect.stringContaining("metadata->>'qa_interest' = $1"), ['synthetic']);
    });
});
