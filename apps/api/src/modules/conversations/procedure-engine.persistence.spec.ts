import { ProcedureEngineService } from './procedure-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

describe('durable procedure missions', () => {
    function fixture() {
        let metadata: any = {};
        let cached: any = null;
        const definition = { id: '44444444-4444-4444-8444-444444444444', name: 'Task', status: 'active', version: 1,
            trigger: { keywords: ['start'] }, steps: [{ id: 'act', type: 'tool', config: { tool: 'get_order_status', args: { orderId: 'order' } } },
                { id: 'ask', type: 'ask', config: { field: 'reason', question: 'Reason?' } }] };
        const prisma: any = { executeInTenantSchema: jest.fn(async (_schema, sql, params) => {
            if (sql.startsWith('SELECT metadata')) return [{ metadata: structuredClone(metadata) }];
            if (sql.startsWith('UPDATE conversations')) {
                if (params[1]) metadata = { ...metadata, ...JSON.parse(params[1]) };
                else { delete metadata.procedureState; metadata.procedureStateManaged = true; }
                return [{ id: params[0] }];
            }
            return [definition];
        }) };
        const redis: any = { getJson: jest.fn(async () => cached), setJson: jest.fn(async (_key, value) => { cached = structuredClone(value); }), del: jest.fn(async () => { cached = null; }) };
        const executor: any = { execute: jest.fn(async () => {
            expect(metadata.procedureState.currentStepId).toBe('act');
            return { success: true };
        }) };
        const engine = new ProcedureEngineService(prisma, redis, executor);
        (engine as any).loadActiveProcedures = jest.fn(async () => [definition]);
        return { engine, prisma, redis, executor, metadata: () => metadata, dropCache: () => { cached = null; }, restart: () => new ProcedureEngineService(prisma, redis, executor) };
    }
    it('checkpoints before execution and restores the next task after Redis expiry and process restart', async () => {
        const h = fixture();
        await h.engine.process('schema', 'tenant', 'conversation', 'contact', 'start', { authority: authorityFor('get_order_status') });
        expect(h.executor.execute).toHaveBeenCalledTimes(1);
        h.dropCache();
        expect(await h.restart().getState('conversation', 'schema')).toMatchObject({ currentStepId: 'ask', awaitingField: 'reason', expiresAt: expect.any(String) });
    });
    it('does not resurrect a completed task when Redis deletion fails', async () => {
        const h = fixture();
        await h.engine.process('schema', 'tenant', 'conversation', 'contact', 'start', { authority: authorityFor('get_order_status') });
        h.redis.del.mockRejectedValue(new Error('redis unavailable'));
        await h.engine.clearState('conversation', 'schema');
        expect(await h.restart().getState('conversation', 'schema')).toBeNull();
    });
    it('never invokes a tool when the durable checkpoint cannot be written', async () => {
        const h = fixture();
        h.prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => {
            if (sql.startsWith('UPDATE')) throw new Error('database unavailable');
            return [{ metadata: {} }];
        });
        await expect(h.engine.process('schema', 'tenant', 'conversation', 'contact', 'start', { authority: authorityFor('get_order_status') })).rejects.toThrow('database unavailable');
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it('uses isolated session persistence without mutating live durable state', async () => {
        const h = fixture();
        const store = { load: jest.fn().mockResolvedValue(null), save: jest.fn().mockResolvedValue(undefined), clear: jest.fn().mockResolvedValue(undefined) };
        const isolated = h.engine.forExecution({ persistence: store });
        await isolated.clearState('conversation', 'schema');
        expect(store.clear).toHaveBeenCalledWith('schema', 'conversation');
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('uses session definitions for discovery and resume without consulting live sources', async () => {
        const h = fixture();
        let state: any = null;
        const definition: any = { id: '55555555-5555-4555-8555-555555555555', name: 'Frozen task', status: 'active', version: 3,
            trigger: { keywords: ['start'] }, steps: [{ id: 'ask', type: 'ask', config: { field: 'reason', question: 'Frozen question?' } }] };
        const definitions = { listActive: jest.fn(async () => [definition]), getById: jest.fn(async () => definition) };
        const persistence = { load: jest.fn(async () => structuredClone(state)), save: jest.fn(async (_schema, _id, next) => { state = structuredClone(next); }), clear: jest.fn(async () => { state = null; }) };
        const isolated = h.engine.forExecution({ persistence, definitions });
        expect(await isolated.process('isolated_schema', 'tenant', 'conversation', 'contact', 'start')).toMatchObject({ text: 'Frozen question?' });
        await isolated.process('isolated_schema', 'tenant', 'conversation', 'contact', 'más tarde');
        expect(definitions.listActive).toHaveBeenCalledWith('isolated_schema');
        expect(definitions.getById).toHaveBeenCalledWith('isolated_schema', definition.id);
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(h.redis.getJson).not.toHaveBeenCalled();
        state.expiresAt = '2020-01-01T00:00:00Z';
        expect(await isolated.getState('conversation', 'isolated_schema')).toBeNull();
        expect(persistence.clear).toHaveBeenCalled();
    });
});
