import * as fs from 'node:fs';
import * as path from 'node:path';
import { evaluate, fromLegacyRows, type LegacyTenantRows } from '@parallext/business-spec';
import { loadSpec } from '@parallext/business-spec/load';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ReadinessController } from './readiness.controller';
import { ReadinessService, prismaJsonRunner, readinessCacheKey } from './readiness.service';

const FIXTURES = path.resolve(__dirname, '../../../../../packages/business-spec/test/fixtures/qa-tenants');
const NOW = new Date('2026-10-30T12:00:00.000Z');
const TENANT = '5f7883f0-0000-4000-8000-000000000001';
const SCHEMA = 'tenant_spark_qa_dental_03_5f7883f07f09490698006a07dfe82dc7';
const fixture = (slug: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${slug}.snapshot.json`), 'utf8')) as LegacyTenantRows;

/** Base de datos falsa: devuelve las filas golden al SELECT del lector y guarda `readiness_evaluations` en memoria. */
function fakeDb(rows: LegacyTenantRows, opts: { historyTable?: boolean } = {}) {
    const history: Array<{ id: string; result_hash: string; verdict: string; spec_version: string; counts: unknown; result: any; trigger: string; created_at: Date }> = [];
    const statements: string[] = [];
    const missing = () => Object.assign(new Error('relation "readiness_evaluations" does not exist'), { code: '42P01' });
    const tx = {
        $executeRawUnsafe: jest.fn(async (sql: string) => { statements.push(sql); }),
        $queryRawUnsafe: jest.fn(async (sql: string) => {
            statements.push(sql);
            if (sql.includes('information_schema.tables')) return [{ v: Object.keys(rows).filter(k => Array.isArray((rows as any)[k])) }];
            return [{ v: rows }];
        }),
    };
    const query = async (sql: string, params: any[] = []) => {
        if (opts.historyTable === false) throw missing();
        if (/^\s*SELECT id::text AS id, result_hash/.test(sql)) return history.slice(-1).map(h => ({ id: h.id, result_hash: h.result_hash, verdict: h.verdict }));
        if (/^\s*INSERT INTO readiness_evaluations/.test(sql)) {
            const row = { id: `ev-${history.length + 1}`, spec_version: params[0], result_hash: params[2], verdict: params[3], counts: JSON.parse(params[4]), result: JSON.parse(params[5]), trigger: params[6], created_at: new Date(NOW.getTime() + history.length) };
            history.push(row);
            return [{ id: row.id }];
        }
        throw new Error(`SQL inesperado: ${sql}`);
    };
    const prisma = {
        getTenantSchemaName: jest.fn(async () => SCHEMA),
        $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
        transactionInTenantSchema: jest.fn(async (_schema: string, fn: (q: typeof query) => unknown) => fn(query)),
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: any[]) => {
            if (opts.historyTable === false) throw missing();
            expect(sql).toMatch(/FROM readiness_evaluations ORDER BY created_at DESC/);
            return [...history].reverse().slice(0, params[0]).map(h => ({ ...h, blocking_gaps: h.result.blockingGaps }));
        }),
    };
    return { prisma, history, statements };
}

function fakeRedis() {
    const store = new Map<string, string>();
    return {
        store,
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
        del: jest.fn(async (k: string) => { store.delete(k); }),
    };
}

class FixedClockReadiness extends ReadinessService {
    protected now(): Date { return NOW; }
}

function build(slug = 'spark-qa-dental-03', opts: { historyTable?: boolean } = {}) {
    const db = fakeDb(fixture(slug), opts);
    const redis = fakeRedis();
    const events = { emit: jest.fn() };
    const service = new FixedClockReadiness(db.prisma as any, redis as any, events as any);
    return { service, db, redis, events };
}

describe('ReadinessService', () => {
    const spec = loadSpec();

    it.each(['spark-qa-dental-03', 'spark-qa-comida-04', 'spark-qa-hotel-09'])('%s: da el mismo veredicto y hash que el motor (la CLI) sobre la misma foto', async slug => {
        const { service } = build(slug);
        const view = await service.getCurrent(TENANT);
        const rows = { ...fixture(slug), capturedAt: NOW.toISOString() };
        const cli = evaluate(spec, fromLegacyRows(rows), NOW);
        expect(view.result.verdict).toBe(cli.verdict);
        expect(view.result.blockingGaps).toEqual(cli.blockingGaps);
        expect(view.result.resultHash).toBe(cli.resultHash);
    });

    it('lee la foto en una transacción de solo lectura', async () => {
        const { service, db } = build();
        await service.readSnapshot(TENANT);
        expect(db.statements[0]).toBe('SET TRANSACTION READ ONLY');
        expect(db.statements.filter(s => /\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i.test(s))).toEqual([]);
    });

    it('guarda una fila por resultado distinto: reevaluar sin cambios no agrega historial', async () => {
        const { service, db } = build();
        const first = await service.getCurrent(TENANT, { refresh: true });
        const second = await service.getCurrent(TENANT, { refresh: true });
        expect(db.history).toHaveLength(1);
        expect(first.evaluationId).toBe('ev-1');
        expect(second.evaluationId).toBe('ev-1');
        expect(db.history[0]).toMatchObject({ verdict: first.result.verdict, result_hash: first.result.resultHash, trigger: 'refresh' });
        const history = await service.getHistory(TENANT);
        expect(history).toEqual([expect.objectContaining({ id: 'ev-1', verdict: first.result.verdict, blockingGaps: first.result.blockingGaps })]);
    });

    it('sirve la última evaluación desde la caché y la invalida a pedido', async () => {
        const { service, db, redis } = build();
        await service.getCurrent(TENANT);
        const reads = db.prisma.$transaction.mock.calls.length;
        const cached = await service.getCurrent(TENANT);
        expect(cached.cached).toBe(true);
        expect(db.prisma.$transaction.mock.calls.length).toBe(reads);
        expect(redis.store.has(readinessCacheKey(TENANT, spec.specVersion))).toBe(true);
        await service.invalidate(TENANT);
        expect(redis.store.has(readinessCacheKey(TENANT, spec.specVersion))).toBe(false);
        expect((await service.getCurrent(TENANT)).cached).toBe(false);
    });

    it('avisa cuando el veredicto cambia respecto de la última fila', async () => {
        const { service, db, events } = build();
        db.history.push({ id: 'ev-0', result_hash: 'otro', verdict: 'listo', spec_version: spec.specVersion, counts: {}, result: { blockingGaps: [] }, trigger: 'on_demand', created_at: new Date(0) });
        const view = await service.getCurrent(TENANT, { refresh: true });
        expect(events.emit).toHaveBeenCalledWith('readiness.verdict_changed', { tenantId: TENANT, from: 'listo', to: view.result.verdict });
        expect(events.emit).toHaveBeenCalledWith('readiness.evaluated', expect.objectContaining({ tenantId: TENANT, changed: true }));
    });

    it('sin la tabla de historial (tenant aún no migrado) sigue mostrando la preparación', async () => {
        const { service } = build('spark-qa-dental-03', { historyTable: false });
        const view = await service.getCurrent(TENANT);
        expect(view.evaluationId).toBeNull();
        expect(view.result.verdict).toBe('no_listo');
        expect(await service.getHistory(TENANT)).toEqual([]);
    });

    it('dos pedidos simultáneos comparten una sola lectura', async () => {
        const { service, db } = build();
        await Promise.all([service.getCurrent(TENANT, { refresh: true }), service.getCurrent(TENANT, { refresh: true })]);
        expect(db.prisma.getTenantSchemaName.mock.calls.length).toBe(2); // una lectura de foto + una escritura
    });

    it('currentVerdict nunca lanza: null si la preparación no se puede leer', async () => {
        const { service, db } = build();
        db.prisma.getTenantSchemaName.mockRejectedValueOnce(new Error('caído'));
        await expect(service.currentVerdict(TENANT)).resolves.toBeNull();
        await expect(service.currentVerdict(TENANT)).resolves.toBe('no_listo');
    });

    it('detalle de un requisito: definición de la especificación y su evaluación actual', async () => {
        const { service } = build();
        const detail = await service.getRequirement(TENANT, 'CORE.IDENTITY.REGION');
        expect(detail.definition).toMatchObject({ id: 'CORE.IDENTITY.REGION', level: expect.any(String), uiTarget: spec.requirements['CORE.IDENTITY.REGION'].uiTarget });
        expect(detail.evaluation?.id).toBe('CORE.IDENTITY.REGION');
        // C6: el descriptor del cajón y el valor que lee el motor (heredado de tenants.operating_* en la foto golden)
        expect(detail.form).toMatchObject({ schema: 'business-spec/form@1', requirementId: 'CORE.IDENTITY.REGION', mode: 'form' });
        expect(detail.form.fields.map(f => f.key)).toEqual(expect.arrayContaining(['operating_country', 'timezone', 'currency']));
        expect(detail.current.state).toEqual(detail.evaluation?.valueState);
        await expect(service.getRequirement(TENANT, 'NO.EXISTE')).rejects.toThrow(/desconocido/);
    });

    it('el lector por Prisma desenvuelve el único valor JSON', async () => {
        const tx = { $executeRawUnsafe: jest.fn(), $queryRawUnsafe: jest.fn(async (_sql: string) => [{ v: { a: 1 } }]) };
        const runner = prismaJsonRunner({ $transaction: async (fn: any) => fn(tx) } as any);
        await expect(runner.queryJson('SELECT 1;')).resolves.toEqual({ a: 1 });
        expect(tx.$queryRawUnsafe.mock.calls[0][0]).toBe('SELECT q.v::jsonb AS v FROM (SELECT 1) AS q(v)');
    });
});

describe('ReadinessController', () => {
    const roles = (method: keyof ReadinessController) => Reflect.getMetadata(ROLES_KEY, ReadinessController.prototype[method]);

    it('la foto cruda es solo de la plataforma; la lectura, del dueño y el supervisor', () => {
        expect(roles('snapshot')).toEqual(['super_admin']);
        for (const m of ['current', 'history', 'requirement'] as const) expect(roles(m)).toEqual(['super_admin', 'tenant_admin', 'tenant_supervisor']);
    });

    it('responde con el sobre { success, data } y pasa refresh=1', async () => {
        const service = {
            getCurrent: jest.fn(async () => ({ result: { verdict: 'listo' } })), getHistory: jest.fn(async () => []),
            formRequirementIds: ['CORE.IDENTITY.NAME'], screenTargets: jest.fn(() => ({ 'CORE.OFFER.ITEMS': '/admin/menu' })),
        };
        const controller = new ReadinessController(service as any, {} as any, {} as any);
        await expect(controller.current(TENANT, '1')).resolves.toEqual({
            success: true,
            data: { result: { verdict: 'listo' }, formRequirementIds: ['CORE.IDENTITY.NAME'], screenTargets: { 'CORE.OFFER.ITEMS': '/admin/menu' } },
        });
        expect(service.getCurrent).toHaveBeenCalledWith(TENANT, { refresh: true });
        await controller.current(TENANT);
        expect(service.getCurrent).toHaveBeenLastCalledWith(TENANT, { refresh: false });
        await expect(controller.history(TENANT, '5')).resolves.toEqual({ success: true, data: [] });
        expect(service.getHistory).toHaveBeenCalledWith(TENANT, 5);
    });

    it('el detalle del requisito suma la fila guardada con su versión (lo que abre el cajón)', async () => {
        const service = { getRequirement: jest.fn(async () => ({ specVersion: 'v', form: { mode: 'form' } })) };
        const facts = { get: jest.fn(async () => ({ fact: { version: 3 } })) };
        const controller = new ReadinessController(service as any, facts as any, {} as any);
        await expect(controller.requirement(TENANT, 'CORE.IDENTITY.NAME')).resolves.toEqual({ success: true, data: { specVersion: 'v', form: { mode: 'form' }, fact: { version: 3 } } });
        expect(facts.get).toHaveBeenCalledWith(TENANT, 'CORE.IDENTITY.NAME', '');
    });

    it('la lista de ids con formulario incluye los 13 bloqueantes con valor y WRITE_MODE de los 15 objetos', () => {
        const { service } = build();
        const ids = service.formRequirementIds;
        expect(ids).toEqual(expect.arrayContaining(['CORE.IDENTITY.NAME', 'CORE.HOURS.REGULAR', 'CORE.HANDOFF.HOURS_SLA', 'OBJ.LEAD.WRITE_MODE', 'OBJ.APPOINTMENT.CHANGE_RULES']));
        expect(ids).not.toContain('CORE.OFFER.ITEMS');
        expect(ids).not.toContain('CORE.OFFER.PRICE_MODEL');
    });

    it('el catálogo enlaza a la pantalla del objeto del tenant (restaurante: menú), no a la de servicios', async () => {
        const { service } = build('spark-qa-comida-04');
        const view = await service.getCurrent(TENANT);
        const targets = service.screenTargets(view.result);
        expect(targets['CORE.OFFER.ITEMS']).toBe('/admin/menu');
        expect(targets['CORE.OFFER.PRICE_MODEL']).toBe('/admin/menu');
        const dental = build();
        expect(dental.service.screenTargets((await dental.service.getCurrent(TENANT)).result)['CORE.OFFER.ITEMS']).toBe('/admin/service-catalog');
    });
});
