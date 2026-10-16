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

describe('Segment IN values from the visible comma-list form', () => {
    let service: SegmentsService;
    let controller: CrmController;
    let execute: jest.Mock;
    beforeEach(() => {
        // Synthetic score7: distinguish an ignored filter from a negative list.
        execute = jest.fn(async (_schema: string, sql: string, params: unknown[]) => [{ count: !sql.includes(' WHERE ') || params.includes('7') ? 1 : 0 }]);
        service = Object.create(SegmentsService.prototype);
        Object.assign(service, { getTenantSchema: jest.fn().mockResolvedValue('tenant_synthetic'), prisma: { executeInTenantSchema: execute }, logger: { log: jest.fn() } });
        controller = Object.create(CrmController.prototype);
        Object.assign(controller, { segmentsService: service });
    });
    it.each([['2,3', 0, ['2', '3']], [' 7, 8 ', 1, ['7', '8']]])('previews form score IN %s with bound numeric values', async (value, count, params) => {
        await expect(controller.createSegment('synthetic', { preview: true, filterRules: [{ field: 'score', operator: 'in', value }] })).resolves.toEqual({ success: true, data: { count } });
        expect(execute).toHaveBeenCalledWith('tenant_synthetic', expect.stringContaining('score IN ($1::numeric, $2::numeric)'), params);
        expect(execute).toHaveBeenCalledTimes(1);
    });
    it('keeps comma-list text literal and parameterized', async () => {
        await controller.createSegment('synthetic', { preview: true, filterRules: [{ field: 'stage', operator: 'in', value: " consulta, x' OR 1=1 -- " }] });
        expect(execute).toHaveBeenCalledWith('tenant_synthetic', expect.stringContaining('stage IN ($1, $2)'), ['consulta', "x' OR 1=1 --"]);
        expect(execute.mock.calls[0][1]).not.toContain("OR 1=1");
    });
    it('preserves existing array callers', async () => {
        await service.previewSegment('synthetic', [{ field: 'score', operator: 'in', value: ['2', '7'] }]);
        expect(execute).toHaveBeenCalledWith('tenant_synthetic', expect.stringContaining('score IN ($1::numeric, $2::numeric)'), ['2', '7']);
    });
    it.each([['empty text', ''], ['whitespace', '  '], ['empty array', []], ['missing member', '2,,3'], ['null', null], ['nested array', [['7']]], ['empty array member', ['']], ['object member', [{ score: 7 }]]])('rejects %s before querying leads', async (_label, value) => {
        await expect(service.previewSegment('synthetic', [{ field: 'score', operator: 'in', value }])).rejects.toBeInstanceOf(BadRequestException);
        expect(execute).not.toHaveBeenCalled();
    });
});
