import { KnowledgeService } from './knowledge.service';

function harness() {
    const rows = [
        { id: 'synthetic-draft', title: 'Unreviewed QA', status: 'draft' },
        { id: 'synthetic-approved', title: 'Reviewed QA', status: 'approved' },
    ];
    const query = jest.fn(async (_schema: string, sql: string, params: unknown[] = []) => {
        if (/^UPDATE/i.test(sql.trim())) {
            rows.forEach(row => { if (row.status === 'draft') row.status = 'approved'; });
            return [];
        }
        if (!/^SELECT/i.test(sql.trim())) throw new Error('unexpected statement');
        return rows.filter(row => !params.length || row.status === params[0]).map(row => ({ ...row }));
    });
    const service = Object.create(KnowledgeService.prototype) as KnowledgeService;
    Object.assign(service, { prisma: { executeInTenantSchema: query } });
    return { service, query, rows };
}

describe('legacy knowledge library reads preserve review state', () => {
    it.each([undefined, 'draft', 'approved'])('lists status %s without approving any draft', async (status) => {
        const { service, query, rows } = harness();
        const before = rows.map(row => ({ ...row }));
        const result = await service.getResources('tenant_synthetic', status);
        expect(rows).toEqual(before);
        expect(result).toEqual(before.filter(row => !status || row.status === status));
        expect(query).toHaveBeenCalledTimes(1);
        const [schema, sql, params] = query.mock.calls[0];
        expect(schema).toBe('tenant_synthetic');
        expect(sql.trim()).toMatch(/^SELECT /);
        if (status) {
            expect(sql).toContain('status = $1');
            expect(params).toEqual([status]);
        }
    });

    it('propagates a failed read without attempting any business write', async () => {
        const { service, query, rows } = harness();
        const before = rows.map(row => ({ ...row }));
        query.mockRejectedValueOnce(new Error('synthetic read unavailable'));
        await expect(service.getResources('tenant_synthetic', 'draft')).rejects.toThrow('synthetic read unavailable');
        expect(rows).toEqual(before);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][1].trim()).toMatch(/^SELECT /);
    });
});
