import { AppointmentsService, AGENDA_LIST_LIMIT, AGENDA_LIST_LIMIT_MAX } from './appointments.service';
import { AppointmentsController } from './appointments.controller';

/**
 * The dashboard agenda now asks for about seven months of appointments, so the
 * read has to be bounded, and say so when it is cut.
 */
describe('agenda list is bounded', () => {
    const schemaName = 'tenant_list_page';

    function row(i: number) {
        return {
            id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
            contact_id: null, conversation_id: null, service_name: 'Corte',
            start_at: '2026-10-12T09:00:00', end_at: '2026-10-12T09:45:00',
            status: 'confirmed', source: 'manual', created_at: '2026-10-01T00:00:00Z',
        };
    }

    function harness(total: number) {
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
            const limit = sql.includes(' LIMIT $') ? params[params.length - 1] as number : total;
            return Array.from({ length: Math.min(total, limit) }, (_, i) => row(i));
        });
        const prisma = { executeInTenantSchema, tenant: { findFirst: jest.fn().mockResolvedValue(null) } };
        const service = new AppointmentsService(
            prisma as any, { emit: jest.fn() } as any, { enqueueWithQuery: jest.fn() } as any,
            { timezoneFor: jest.fn(), timezoneForSchema: jest.fn() } as any,
        );
        return { service, executeInTenantSchema };
    }

    it('returns everything and says so when the list fits under the cap', async () => {
        const { service } = harness(3);
        const page = await service.listPage(schemaName, { startDate: '2026-10-01' });
        expect(page.items).toHaveLength(3);
        expect(page.truncated).toBe(false);
        expect(page.limit).toBe(AGENDA_LIST_LIMIT);
    });

    it('stops at the cap, never returns the probe row, and reports the cut', async () => {
        const { service, executeInTenantSchema } = harness(AGENDA_LIST_LIMIT + 50);
        const page = await service.listPage(schemaName, {});
        expect(page.items).toHaveLength(AGENDA_LIST_LIMIT);
        expect(page.truncated).toBe(true);
        const [, sql, params] = executeInTenantSchema.mock.calls[0];
        expect(sql).toContain('ORDER BY a.start_at ASC LIMIT $');
        // One row more than the cap is requested, to know whether there is more.
        expect(params?.at(-1)).toBe(AGENDA_LIST_LIMIT + 1);
    });

    it('does not report a cut for exactly the cap', async () => {
        const { service } = harness(AGENDA_LIST_LIMIT);
        const page = await service.listPage(schemaName, {});
        expect(page.items).toHaveLength(AGENDA_LIST_LIMIT);
        expect(page.truncated).toBe(false);
    });

    it('clamps a requested limit into 1..max', async () => {
        const { service } = harness(5);
        expect((await service.listPage(schemaName, {}, 2)).items).toHaveLength(2);
        expect((await service.listPage(schemaName, {}, 0)).limit).toBe(1);
        expect((await service.listPage(schemaName, {}, 99999)).limit).toBe(AGENDA_LIST_LIMIT_MAX);
        expect((await service.listPage(schemaName, {}, Number.NaN)).limit).toBe(AGENDA_LIST_LIMIT);
    });

    it('keeps the unbounded list for callers that never asked for a page', async () => {
        const { service, executeInTenantSchema } = harness(7);
        expect(await service.list(schemaName, {})).toHaveLength(7);
        expect(executeInTenantSchema.mock.calls[0][1]).not.toContain(' LIMIT $');
    });

    it('the endpoint hands the page and its truncation to the screen', async () => {
        const listPage = jest.fn().mockResolvedValue({ items: [{ id: 'a' }], truncated: true, limit: AGENDA_LIST_LIMIT });
        const controller = new AppointmentsController({ listPage } as any, {} as any, {} as any, {} as any, {} as any);
        const result = await controller.list('t', { schemaName } as any, undefined, undefined, '2026-10-01', '2027-04-01T23:59:59');
        expect(result).toEqual({ success: true, data: [{ id: 'a' }], meta: { limit: AGENDA_LIST_LIMIT, truncated: true } });
    });
});
