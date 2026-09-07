import { runtimeStateTransactions } from './__fixtures__/runtime-state.fixture';
import type { ProcedureDefinition, ProcedureRunState } from '@parallext/shared';
import { ProcedureEngineService } from './procedure-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

function fixture() {
    const definitions: ProcedureDefinition[] = [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Return', version: 1, status: 'active', trigger: { keywords: ['devolucion', 'return', 'devolucao', 'retour'] }, steps: [
            { id: 'email', type: 'ask', config: { field: 'email', fieldType: 'email', question: 'Email?' } },
            { id: 'reason', type: 'ask', config: { field: 'reason', question: 'Reason?' } },
        ] },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Order lookup', version: 1, status: 'active', trigger: { keywords: ['pedido', 'order', 'commande'] }, steps: [
            { id: 'order', type: 'ask', config: { field: 'orderId', fieldType: 'uuid', question: 'Order ID?' } },
            { id: 'lookup', type: 'tool', config: { tool: 'get_order_status', args: { orderId: '{{ orderId }}' } } },
        ] },
    ];
    let metadata: any = { procedureStateManaged: true };
    const cache = new Map<string, any>();
    let failDefinitionRead = false;
    const prisma: any = { executeInTenantSchema: jest.fn(async (_schema, sql, params) => {
        if (sql.startsWith('SELECT metadata')) return [{ metadata: structuredClone(metadata) }];
        if (sql.startsWith('UPDATE conversations')) {
            if (params[1]) { for (const key of params[2] || []) delete metadata[key]; metadata = { ...metadata, ...JSON.parse(params[1]) }; }
            else { delete metadata.procedureState; metadata.procedureStateManaged = true; }
            return [{ id: params[0] }];
        }
        if (sql.includes('to_regclass')) return [{ reg: 'procedures' }];
        if (sql.includes('FROM procedures WHERE id')) {
            if (failDefinitionRead) throw new Error('definition temporarily unavailable');
            const found = definitions.find(def => def.id === params[0]);
            return found ? [structuredClone(found)] : [];
        }
        if (sql.includes('FROM procedures')) return structuredClone(definitions.filter(def => def.status === 'active'));
        throw new Error(`unexpected query ${sql}`);
    }) };
    const redis: any = { getJson: jest.fn(async key => structuredClone(cache.get(key) ?? null)),
        setJson: jest.fn(async (key, value) => { cache.set(key, structuredClone(value)); }), del: jest.fn(async key => { cache.delete(key); }) };
    const executor: any = { execute: jest.fn(async () => ({ success: true, status: 'processing' })) };
    runtimeStateTransactions(prisma);
    const newEngine = () => new ProcedureEngineService(prisma, redis, executor);
    let engine = newEngine();
    return {
        definitions, executor, prisma,
        state: (): ProcedureRunState | null => structuredClone(metadata.procedureState ?? null),
        setState: (state: unknown) => { metadata.procedureState = structuredClone(state); },
        failDefinitionRead: () => { failDefinitionRead = true; },
        restart: () => { cache.clear(); engine = newEngine(); },
        getState: () => engine.getState('conversation', 'schema'),
        turn: (text: string, language = 'es') => engine.process('schema', 'tenant', 'conversation', 'contact', text,
            { language, authority: authorityFor('get_order_status') }),
    };
}

async function pauseReturn(h: ReturnType<typeof fixture>) {
    await h.turn('quiero una devolucion');
    await h.turn('customer@example.test');
    await h.turn('prefiero hacerlo después');
}

describe('independent paused procedure missions', () => {
    it('completes another task, survives a restart, and resumes the original at its pending field', async () => {
        const h = fixture();
        await pauseReturn(h);
        const original = h.state()!;
        expect(await h.turn('ahora quiero consultar un pedido')).toMatchObject({ text: 'Order ID?', handled: true });
        expect(h.state()).toMatchObject({ collected: {}, awaitingField: 'orderId', suspendedMissions: [original] });
        h.restart();
        await h.turn('33333333-3333-4333-8333-333333333333');
        expect(h.executor.execute).toHaveBeenCalledTimes(1);
        expect(h.executor.execute.mock.calls[0][4]).toEqual({ orderId: '33333333-3333-4333-8333-333333333333' });
        expect(h.state()).toMatchObject({ procedureId: original.procedureId, collected: original.collected, awaitingField: 'reason', pausedAt: expect.any(String), expiresAt: original.expiresAt });
        expect(await h.turn('other@example.test')).toMatchObject({ dialogueAct: 'pause' });
        expect(h.state()?.collected).toEqual({ email: 'customer@example.test' });
        expect(await h.turn('continuemos')).toMatchObject({ dialogueAct: 'resume', text: 'Reason?' });
        await h.turn('Llegó defectuoso');
        expect(h.state()).toBeNull();
        expect(h.executor.execute).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['retomar la devolucion', 'es'], ['resume the return', 'en'],
        ['retomar a devolucao', 'pt'], ['reprendre le retour', 'fr'],
    ])('selects a named pending task without consuming the selection as data: %s', async (resume, language) => {
        const h = fixture(); await pauseReturn(h);
        await h.turn('quiero consultar un pedido'); await h.turn('más tarde');
        expect(await h.turn(resume, language)).toMatchObject({ dialogueAct: 'resume', text: 'Reason?' });
        expect(h.state()).toMatchObject({ collected: { email: 'customer@example.test' }, awaitingField: 'reason',
            suspendedMissions: [{ procedureId: h.definitions[1].id, collected: {}, awaitingField: 'orderId' }] });
        expect(h.executor.execute).not.toHaveBeenCalled();
        await h.turn('No funcionó');
        expect(h.state()).toMatchObject({ procedureId: h.definitions[1].id, collected: {}, pausedAt: expect.any(String) });
    });

    it('can resume the current paused mission by its name', async () => {
        const h = fixture(); await pauseReturn(h);
        expect(await h.turn('retomar la devolucion')).toMatchObject({ dialogueAct: 'resume', text: 'Reason?' });
        expect(h.state()?.collected).toEqual({ email: 'customer@example.test' });
    });

    it('does not choose arbitrarily when a request names both tasks', async () => {
        const h = fixture(); await pauseReturn(h); const previous = h.state();
        expect(await h.turn('quiero consultar pedido y devolucion')).toMatchObject({ handled: true, dialogueAct: 'pause' });
        expect(h.state()).toEqual(previous);
        expect(h.executor.execute).not.toHaveBeenCalled();
    });

    it('does not select another task on a question or a human request', async () => {
        const h = fixture(); await pauseReturn(h);
        await h.turn('quiero saber del pedido');
        expect(h.state()?.procedureId).toBe(h.definitions[0].id);
        expect(await h.turn('quiero hablar con un humano sobre mi pedido')).toMatchObject({ handoff: true, completed: false });
        expect(h.state()?.procedureId).toBe(h.definitions[0].id);
        expect(h.executor.execute).not.toHaveBeenCalled();
    });

    it('cancels only the current collection, while opt-out removes all pending tasks', async () => {
        const h = fixture(); await pauseReturn(h);
        await h.turn('quiero consultar un pedido');
        expect(await h.turn('ya no quiero continuar')).toMatchObject({ dialogueAct: 'cancel', completed: false });
        expect(h.state()?.procedureId).toBe(h.definitions[0].id);
        await h.turn('quiero consultar un pedido');
        await h.turn('STOP');
        expect(h.state()).toBeNull();
        expect(h.executor.execute).not.toHaveBeenCalled();
    });

    it('leaves a named business cancellation to the domain workflow without discarding either collection', async () => {
        const h = fixture(); await pauseReturn(h);
        await h.turn('quiero consultar un pedido'); await h.turn('más tarde');
        const previous = h.state();
        expect(await h.turn('quiero cancelar la devolucion')).toMatchObject({ handled: false, dialogueAct: 'pause', completed: false });
        expect(h.state()).toMatchObject({ procedureId: previous!.procedureId, collected: previous!.collected, suspendedMissions: previous!.suspendedMissions });
        expect(h.executor.execute).not.toHaveBeenCalled();
    });

    it('asks to close a task at capacity without evicting pending data', async () => {
        const h = fixture(); await pauseReturn(h);
        const original = h.state()!;
        original.suspendedMissions = Array.from({ length: 4 }, (_, i) => ({ ...original, procedureId: `pending-${i}`, collected: { note: `data ${i}` } }));
        h.setState(original);
        expect(await h.turn('quiero consultar un pedido')).toMatchObject({ handled: true, dialogueAct: 'pause' });
        expect(h.state()).toEqual(original);
    });

    it('restores a younger paused mission if the selected task expired, without extending its retention', async () => {
        const h = fixture(); await pauseReturn(h);
        const old = h.state()!;
        const younger = { ...old, procedureId: h.definitions[1].id, collected: {}, currentStepId: 'order', awaitingField: 'orderId', expiresAt: new Date(Date.now() + 100_000).toISOString() };
        h.setState({ ...old, expiresAt: '2020-01-01T00:00:00Z', suspendedMissions: [younger] });
        expect(await h.getState()).toMatchObject({ ...younger, pausedAt: expect.any(String), suspendedMissions: [] });
        expect(h.state()?.expiresAt).toBe(younger.expiresAt);
        await h.turn('unrelated');
        expect(h.state()?.expiresAt).toBe(younger.expiresAt);
        expect(h.executor.execute).not.toHaveBeenCalled();
    });

    it('discards expired and malformed archived frames without crashing or reviving them', async () => {
        const h = fixture(); await pauseReturn(h);
        const old = h.state()!;
        h.setState({ ...old, expiresAt: '2020-01-01T00:00:00Z', suspendedMissions: [null, { ...old, procedureId: 'expired' }, { procedureId: 'bad' }] });
        // The otherwise-live frame is made expired explicitly too.
        const state: any = h.state(); state.suspendedMissions[1].expiresAt = '2020-01-01T00:00:00Z'; h.setState(state);
        expect(await h.getState()).toBeNull();
        h.setState({ ...old, expiresAt: '2020-01-01T00:00:00Z', suspendedMissions: {} });
        expect(await h.getState()).toBeNull();
    });

    it('revalidates the saved procedure version before resuming and retains other tasks', async () => {
        const h = fixture(); await pauseReturn(h);
        await h.turn('quiero consultar un pedido'); await h.turn('más tarde');
        h.definitions[0].version = 2;
        // A new definition cannot inherit collected fields from its old version.
        expect(await h.turn('retomar la devolucion')).toMatchObject({ text: 'Email?', handled: true });
        expect(h.state()).toMatchObject({ version: 2, collected: {}, suspendedMissions: [{ procedureId: h.definitions[1].id }] });
        expect(h.executor.execute).not.toHaveBeenCalled();
    });

    it('preserves both missions if current definition validation fails transiently', async () => {
        const h = fixture(); await pauseReturn(h);
        await h.turn('quiero consultar un pedido'); await h.turn('más tarde');
        const previous = h.state(); h.failDefinitionRead();
        await expect(h.turn('retomar la devolucion')).rejects.toThrow('definition temporarily unavailable');
        expect(h.state()).toEqual(previous);
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
});
