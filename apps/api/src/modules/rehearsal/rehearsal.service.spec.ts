import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { fromLegacyRows, generateRehearsal, type RehearsalBank } from '@parallext/business-spec';
import { loadSpec } from '@parallext/business-spec/load';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { sessionCanExecute } from '../conversations/agent-turn-adapters';
import { REHEARSAL_COMPLETED_EVENT, RehearsalService, MAX_RUNS_PER_DAY, RUN_DEADLINE_MS } from './rehearsal.service';

/**
 * RehearsalService (R7, ADR 0013): corre el banco por Agent Test en vista previa y guarda los resultados. Lo que se
 * prueba aquí son las garantías del ensayo: ningún efecto (solo escribe `rehearsal_*`, nunca el control de salida ni la
 * bandeja de pendientes), Agent Test sin modo de evaluación ni namespace, el juez solo cuando hace falta, y los límites.
 */
const spec = loadSpec();
const FIXTURES = resolve(__dirname, '../../../../../packages/business-spec/test/fixtures/qa-tenants');
const snapshotOf = (slug: string) => fromLegacyRows(JSON.parse(readFileSync(resolve(FIXTURES, `${slug}.snapshot.json`), 'utf8')));
const AGENT = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';

type Sql = { sql: string; params: unknown[] };

function harness(opts: { running?: number; today?: number; bankRow?: RehearsalBank; reply?: (msg: string, turn: number) => string; testError?: unknown } = {}) {
    const calls: Sql[] = [];
    const stored: { outcome: string; case_key: string }[] = [];
    const prisma = {
        getTenantSchemaName: jest.fn(async () => 'tenant_qa'),
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: unknown[] = []) => {
            calls.push({ sql, params });
            if (/count\(\*\) FILTER/.test(sql)) return [{ running: opts.running ?? 0, today: opts.today ?? 0 }];
            if (/FROM agent_personas/.test(sql)) return [{ id: AGENT }];
            if (/INSERT INTO rehearsal_runs/.test(sql)) {
                return [{ id: RUN, agent_id: params[0], status: 'running', seed: params[1], spec_version: params[2], snapshot_hash: params[3], bank_hash: params[4],
                    repeat_of: params[6], attempt: params[7], case_count: params[8], completed_count: 0, models: [], started_at: new Date().toISOString() }];
            }
            if (/SELECT id, bank, attempt, repeat_of FROM rehearsal_runs/.test(sql)) return opts.bankRow ? [{ id: RUN, bank: opts.bankRow, attempt: 1, repeat_of: null }] : [];
            if (/count\(\*\)::int AS attempts/.test(sql)) return [{ attempts: 1 }];
            if (/INSERT INTO rehearsal_results/.test(sql)) { stored.push({ case_key: String(params[1]), outcome: String(params[8]) }); return []; }
            if (/SELECT outcome FROM rehearsal_results/.test(sql)) return stored.map(s => ({ outcome: s.outcome }));
            return [];
        }),
    };
    const snapshot = { tenantId: 't1', agentId: AGENT };
    let turn = 0;
    const agentTest = {
        captureSnapshot: jest.fn(async () => snapshot),
        releaseSnapshot: jest.fn(async () => undefined),
        snapshotSourceAuthority: jest.fn(() => (invoke: any) => invoke()),
        test: jest.fn(async (_t: string, _a: string, req: any) => {
            if (opts.testError) throw opts.testError;
            turn++;
            return { reply: opts.reply ? opts.reply(req.message, turn) : 'No tengo ese dato confirmado; si quieres lo averiguo.',
                debug: { runtimeSessionId: 'sess-1', toolCalls: [], tokens: { input: 100, output: 20 }, cost: 0.001, model: 'gpt-x', latencyMs: 5 } };
        }),
    };
    const readiness = { spec, readSnapshot: jest.fn(async () => snapshotOf('spark-qa-dental-03')) };
    const judge = { available: true, judge: jest.fn(async () => ({ verdict: { pass: true, reason: 'cumple', model: 'judge' }, tokens: 50 })) };
    const events = { emit: jest.fn() };
    const service = new RehearsalService(prisma as any, readiness as any, agentTest as any, judge as any, events as any);
    return { service, prisma, agentTest, readiness, judge, events, calls, stored, snapshot };
}

const writes = (calls: Sql[]) => calls.map(c => c.sql).filter(s => /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i.test(s));

describe('RehearsalService: ejecución sin efectos', () => {
    const bank = generateRehearsal(spec, snapshotOf('spark-qa-dental-03'), { seed: 'r7', maxCases: 6 });

    it('cada caso pasa por Agent Test en vista previa: foto congelada, herramientas de solo lectura, sin modo de evaluación ni namespace', async () => {
        const h = harness();
        await h.service.execute('t1', 'tenant_qa', RUN, AGENT, bank);
        expect(h.agentTest.captureSnapshot).toHaveBeenCalledTimes(1);
        expect(h.agentTest.test).toHaveBeenCalledTimes(bank.cases.reduce((n, c) => n + c.turns.length, 0));
        for (const [, agentId, , options] of h.agentTest.test.mock.calls as any[]) {
            expect(agentId).toBe(AGENT);
            expect(options).toEqual({ agentSnapshot: h.snapshot, disableTools: false });
            expect(options.evalMode).toBeUndefined();
            expect(options.sandboxNamespace).toBeUndefined();
        }
        expect(h.agentTest.releaseSnapshot).toHaveBeenCalledWith(h.snapshot);
    });

    it('solo escribe rehearsal_runs y rehearsal_results: ni go_live_decisions, ni pending_questions, ni conversaciones', async () => {
        const h = harness();
        await h.service.execute('t1', 'tenant_qa', RUN, AGENT, bank);
        const w = writes(h.calls);
        expect(w.length).toBeGreaterThan(0);
        for (const sql of w) expect(sql).toMatch(/\b(INTO|UPDATE) rehearsal_(runs|results)\b/);
        const all = h.calls.map(c => c.sql).join('\n');
        expect(all).not.toMatch(/go_live|pending_question|conversations|messages|notification|outbox/);
        expect(h.stored).toHaveLength(bank.cases.length);
    });

    it('el modo vista previa de Agent Test no ejecuta escritores y su contexto no persiste', () => {
        const preview = { mode: 'preview', disableTools: false, sandboxNamespace: undefined } as any;
        for (const writer of ['create_appointment', 'place_order', 'create_property_booking', 'place_catalog_order']) {
            expect(sessionCanExecute(preview, writer)).toBe(false);
        }
        expect(AGENT_TEST_EXECUTION_CONTEXT.persistence).toBe('disabled');
    });

    it('termina la ejecución con el resumen y emite rehearsal.completed', async () => {
        const h = harness();
        await h.service.execute('t1', 'tenant_qa', RUN, AGENT, bank);
        const fin = h.calls.find(c => /SET status = \$2, error = \$3, summary/.test(c.sql));
        expect(fin?.params[1]).toBe('completed');
        const summary = JSON.parse(String(fin?.params[3]));
        expect(summary.total).toBe(bank.cases.length);
        expect(h.events.emit).toHaveBeenCalledWith(REHEARSAL_COMPLETED_EVENT, expect.objectContaining({ tenantId: 't1', runId: RUN, status: 'completed' }));
    });

    it('el juez solo se llama sin evidencia determinista y no salva un fallo determinista', async () => {
        // respuestas que dicen una cifra prohibida o no dicen nada útil
        const h = harness({ reply: () => 'Claro, con gusto te ayudo.' });
        await h.service.execute('t1', 'tenant_qa', RUN, AGENT, bank);
        const needing = bank.cases.filter(c => !c.expectation.figuresAnyOf.length && !c.expectation.event && !c.expectation.noMoney);
        expect(h.judge.judge.mock.calls.length).toBeLessThanOrEqual(needing.length);
        for (const c of bank.cases.filter(x => x.expectation.figuresAnyOf.length)) {
            expect(h.stored.find(s => s.case_key === c.key)?.outcome).toBe('wrong');
        }
    });

    it('la cuota de IA agotada detiene la ejecución (stopped) sin seguir gastando', async () => {
        const h = harness({ testError: new HttpException('ai_message_quota_exceeded', HttpStatus.TOO_MANY_REQUESTS) });
        await h.service.execute('t1', 'tenant_qa', RUN, AGENT, bank);
        expect(h.agentTest.test).toHaveBeenCalledTimes(1);
        expect(h.stored).toEqual([expect.objectContaining({ outcome: 'error' })]);
        const fin = h.calls.find(c => /SET status = \$2, error = \$3, summary/.test(c.sql));
        expect(fin?.params.slice(1, 3)).toEqual(['stopped', 'ai_message_quota_exceeded']);
    });

    it('el reloj de 10 minutos corta lo que falte', async () => {
        const h = harness();
        let t = 0;
        jest.spyOn(h.service as any, 'now').mockImplementation(() => { t += RUN_DEADLINE_MS / 2 + 1; return t; });
        await h.service.execute('t1', 'tenant_qa', RUN, AGENT, bank);
        expect(h.stored.length).toBeLessThan(bank.cases.length);
        const fin = h.calls.find(c => /SET status = \$2, error = \$3, summary/.test(c.sql));
        expect(fin?.params.slice(1, 3)).toEqual(['stopped', 'rehearsal_deadline']);
    });
});

describe('RehearsalService.start: límites y banco congelado', () => {
    it('crea la ejecución con el banco del paquete (≤ 40) y la corre en segundo plano', async () => {
        const h = harness();
        const exec = jest.spyOn(h.service, 'execute').mockResolvedValue(undefined);
        const view = await h.service.start('t1', { seed: 'r7' });
        const expected = generateRehearsal(spec, snapshotOf('spark-qa-dental-03'), { seed: 'r7' });
        expect(view).toMatchObject({ id: RUN, status: 'running', bankHash: expected.bankHash, caseCount: expected.cases.length, attempt: 1 });
        expect(view.caseCount).toBeLessThanOrEqual(40);
        expect(exec).toHaveBeenCalledWith('t1', 'tenant_qa', RUN, AGENT, expected);
    });

    it('una ejecución a la vez y una cuota diaria', async () => {
        await expect(harness({ running: 1 }).service.start('t1')).rejects.toBeInstanceOf(ConflictException);
        await expect(harness({ today: MAX_RUNS_PER_DAY }).service.start('t1')).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    });

    it('repetir reutiliza el banco congelado (pass^k): sin volver a leer la foto', async () => {
        const frozen = generateRehearsal(spec, snapshotOf('salon-qa-citas'), { seed: 'k', maxCases: 4 });
        const h = harness({ bankRow: frozen });
        jest.spyOn(h.service, 'execute').mockResolvedValue(undefined);
        const view = await h.service.start('t1', { repeatOf: RUN });
        expect(h.readiness.readSnapshot).not.toHaveBeenCalled();
        expect(view).toMatchObject({ bankHash: frozen.bankHash, attempt: 2, repeatOf: RUN });
    });
});

describe('módulo del ensayo: sin dependencias con efectos', () => {
    it('no importa canales, notificaciones, la bandeja de pendientes ni el control de salida', () => {
        const dir = __dirname;
        for (const f of readdirSync(dir).filter(n => n.endsWith('.ts') && !n.endsWith('.spec.ts'))) {
            const src = readFileSync(resolve(dir, f), 'utf8');
            expect(src).not.toMatch(/from '\.\.\/(channels|pending-knowledge|notifications|whatsapp)\//);
            expect(src).not.toMatch(/go-live|GoLiveService|ProactiveDispatch|BullModule/);
        }
    });
});
