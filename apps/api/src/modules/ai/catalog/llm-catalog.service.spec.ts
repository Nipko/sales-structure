import { BadRequestException, ConflictException } from '@nestjs/common';
import {
    activeLlmCatalog, catalogContent, roleModel, SEED_LLM_CATALOG, setActiveLlmCatalog,
} from '../router/llm-catalog';
import { qualityRubricHash } from '../../quality/quality-rubric';
import { LLM_CATALOG_VERSION_KEY, LlmCatalogService, modelsToProbe } from './llm-catalog.service';
import { measurementKey } from './llm-measurement.service';
import type { MeasurementLite } from './promotion-rule';

/** Base en memoria que entiende las sentencias de `LlmCatalogService` (el SQL real lo cubre el ensayo de la migración). */
function fakeDb() {
    const rows: any[] = [];
    const audit: any[] = [];
    let failing = false;
    const text = (strings: TemplateStringsArray) => strings.join('?').replace(/\s+/g, ' ').trim();
    const row = (version: number, status: string, snapshot: string, extra: Record<string, unknown> = {}) => ({
        id: `id-${version}`, version, status, snapshot: JSON.parse(snapshot), parent_version: null, reason: 'r',
        created_by: null, published_by: null, created_at: new Date(), published_at: null, validation: null, ...extra,
    });
    const $queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        if (failing) throw new Error('db down');
        const sql = text(strings);
        if (sql.includes('pg_advisory_xact_lock')) return [{ pg_advisory_xact_lock: '' }];
        if (sql.startsWith('SELECT * FROM "public"."llm_catalog_versions" WHERE "status" = \'active\'')) return rows.filter(r => r.status === 'active').slice(0, 1);
        if (sql.startsWith('SELECT "version" FROM') && sql.includes('FOR UPDATE')) return rows.filter(r => r.status === 'active').map(r => ({ version: r.version }));
        if (sql.includes('WHERE "version" = ? LIMIT 1')) return rows.filter(r => r.version === values[0]);
        if (sql.includes('ORDER BY "version" DESC')) return [...rows].sort((a, b) => b.version - a.version).slice(0, values[0]);
        if (sql.startsWith('INSERT INTO') && sql.includes("'draft'")) {
            const created = row(Math.max(0, ...rows.map(r => r.version)) + 1, 'draft', values[0], { parent_version: values[1], reason: values[2], created_by: values[3] });
            rows.push(created);
            return [created];
        }
        if (sql.includes('SET "snapshot" = COALESCE')) {
            const r = rows.find(x => x.version === values[2] && x.status === 'draft');
            if (!r) return [];
            if (values[0] != null) r.snapshot = JSON.parse(values[0]);
            if (values[1] != null) r.reason = values[1];
            r.validation = null;
            return [r];
        }
        if (sql.includes('SET "status" = \'active\'')) {
            const r = rows.find(x => x.version === values[1] && x.status === 'draft');
            if (!r) return [];
            Object.assign(r, { status: 'active', published_by: values[0], published_at: new Date() });
            return [r];
        }
        throw new Error(`unhandled query: ${sql}`);
    });
    const $executeRaw = jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        if (failing) throw new Error('db down');
        const sql = text(strings);
        if (sql.startsWith('INSERT INTO') && sql.includes("SELECT 1, 'active'")) {
            if (rows.length) return 0;
            rows.push(row(1, 'active', values[0], { validation: JSON.parse(values[1]), published_at: new Date() }));
            return 1;
        }
        if (sql.includes('SET "validation" =')) {
            const r = rows.find(x => x.version === values[1] && x.status === 'draft');
            if (r) r.validation = JSON.parse(values[0]);
            return r ? 1 : 0;
        }
        if (sql.includes('SET "status" = \'superseded\'')) {
            rows.filter(r => r.status === 'active').forEach(r => { r.status = 'superseded'; });
            return 1;
        }
        throw new Error(`unhandled statement: ${sql}`);
    });
    const db: any = { $queryRaw, $executeRaw, auditLog: { create: jest.fn(async ({ data }: any) => { audit.push(data); }) } };
    db.$transaction = async (fn: (tx: any) => Promise<any>) => fn(db);
    return { db, rows, audit, fail: (on: boolean) => { failing = on; } };
}

function fakeRedis() {
    const store = new Map<string, string>();
    return {
        store,
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
        getClient: () => ({ set: async (k: string, v: string, mode?: string) => { if (mode === 'NX' && store.has(k)) return null; store.set(k, v); return 'OK'; } }),
    };
}

function provider(name: string, behaviour: 'ok' | 'no_tool' | 'error' = 'ok') {
    return {
        providerName: name,
        generate: jest.fn(async (opts: any) => {
            if (behaviour === 'error') throw Object.assign(new Error('model_not_found'), { status: 404 });
            if (opts.tools) {
                return behaviour === 'no_tool'
                    ? { content: 'ok', finishReason: 'stop' }
                    : { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 't', type: 'function', function: { name: 'record_probe', arguments: '{"value":"ok"}' } }] };
            }
            return { content: 'ok', finishReason: 'stop' };
        }),
        generateStream: jest.fn(),
    };
}

function measured(modelId: string, bench: MeasurementLite['bench'], pass: number, n: number, daysAgo = 1): MeasurementLite {
    return { modelId, bench, n, pass, passRate: Math.round((pass / n) * 10_000) / 10_000, measuredAt: new Date(Date.now() - daysAgo * 86_400_000), catalogVersion: 1 };
}

function harness(opts: { configured?: string[]; providers?: any[]; measurements?: MeasurementLite[] } = {}) {
    const db = fakeDb();
    const redis = fakeRedis();
    const configured = new Set(opts.configured ?? ['openai', 'google', 'xai', 'deepseek']);
    const keys = { isConfigured: jest.fn(async (p: string) => configured.has(p)) };
    const providers = opts.providers ?? ['openai', 'anthropic', 'google', 'xai', 'deepseek'].map(p => provider(p));
    const table = new Map((opts.measurements ?? []).map(m => [measurementKey(m.modelId, m.bench), m]));
    const measurements = { latest: jest.fn(async () => table) };
    const service = new LlmCatalogService(db.db, redis as any, keys as any, providers as any, measurements as any, { get: () => undefined } as any);
    return { service, db, redis, providers, keys, measurements };
}

/** El contenido de la semilla con un cambio aplicado, como lo mandaría el panel. */
function edited(change: (c: ReturnType<typeof catalogContent>) => void) {
    const content = catalogContent(SEED_LLM_CATALOG);
    change(content);
    return content;
}

const NEW_MODEL = {
    id: 'gpt-6-luna-mini', provider: 'openai', tier: 'tier_3_efficient', costPer1kTokens: 0.0001, costInPer1k: 0.00005,
    costOutPer1k: 0.0002, costCachedInPer1k: 0.000005, maxContextTokens: 400000, supportsTools: true,
    priceSourceUrl: 'https://openai.com/api/pricing/', priceCheckedAt: '2026-11-09',
};
const ACTOR = { userId: '00000000-0000-4000-8000-000000000001' };

afterEach(() => setActiveLlmCatalog(SEED_LLM_CATALOG));

describe('LlmCatalogService (ADR-0030 fase 2)', () => {
    describe('carga', () => {
        it('con la tabla vacía guarda la semilla como versión 1 y la pone a regir', async () => {
            const { service, db, redis } = harness();
            await service.loadActive('startup');
            expect(db.rows).toHaveLength(1);
            expect(db.rows[0]).toMatchObject({ version: 1, status: 'active' });
            expect(db.rows[0].validation.blocking).toEqual([]);
            expect(activeLlmCatalog().version).toBe('1');
            expect(catalogContent(activeLlmCatalog())).toEqual(catalogContent(SEED_LLM_CATALOG));
            expect(redis.store.get(LLM_CATALOG_VERSION_KEY)).toBe('1');
        });

        it('si Postgres no responde sigue con la semilla y no lanza', async () => {
            const { service, db } = harness();
            db.fail(true);
            await expect(service.loadActive('startup')).resolves.toBeUndefined();
            expect(activeLlmCatalog()).toBe(SEED_LLM_CATALOG);
        });

        it('una versión activa malformada no reemplaza a la que rige', async () => {
            const { service, db } = harness();
            db.rows.push({ id: 'x', version: 7, status: 'active', snapshot: { models: 'nope' } });
            await service.loadActive('startup');
            expect(activeLlmCatalog()).toBe(SEED_LLM_CATALOG);
        });

        it('refresh recarga cuando la clave Redis anuncia otra versión, y si Redis la perdió la vuelve a escribir', async () => {
            const { service, db, redis } = harness();
            await service.loadActive('startup');
            const draft = await service.createDraft({ reason: 'otra', snapshot: edited(c => { c.models[0].costOutPer1k = 0.011; }) }, ACTOR);
            // Otra réplica publica: cambia la base y la clave, este proceso aún no se enteró.
            db.rows[0].status = 'superseded';
            db.rows.find(r => r.version === draft.version).status = 'active';
            redis.store.set(LLM_CATALOG_VERSION_KEY, String(draft.version));
            await service.refresh();
            expect(activeLlmCatalog().version).toBe(String(draft.version));
            expect(activeLlmCatalog().models[0].costOutPer1k).toBe(0.011);
            redis.store.delete(LLM_CATALOG_VERSION_KEY);
            await service.refresh();
            expect(redis.store.get(LLM_CATALOG_VERSION_KEY)).toBe(String(draft.version));
        });
    });

    describe('borradores', () => {
        it('un borrador sin snapshot copia la activa y exige motivo', async () => {
            const { service } = harness();
            await service.loadActive('startup');
            await expect(service.createDraft({ reason: '  ' }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
            const draft = await service.createDraft({ reason: 'probar precios' }, ACTOR);
            expect(draft).toMatchObject({ version: 2, status: 'draft', parent_version: 1, created_by: ACTOR.userId });
            expect(draft.snapshot).toEqual(catalogContent(SEED_LLM_CATALOG));
        });

        it('rechaza un snapshot malformado y no edita lo publicado', async () => {
            const { service } = harness();
            await service.loadActive('startup');
            await expect(service.createDraft({ reason: 'x', snapshot: { models: [], chains: {}, roles: {} } }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
            await expect(service.updateDraft(1, { reason: 'x' })).rejects.toBeInstanceOf(ConflictException);
        });
    });

    describe('validación', () => {
        it('agregar un modelo abajo en una cadena valida con una llamada real (turno y herramienta) y sin medición', async () => {
            const { service, providers } = harness();
            await service.loadActive('startup');
            const draft = await service.createDraft({ reason: 'modelo nuevo', snapshot: edited(c => { c.models.push(NEW_MODEL as any); c.chains.conversation.push(NEW_MODEL.id); }) }, ACTOR);
            const validation = await service.validateDraft(draft.version);
            expect(validation).toMatchObject({ valid: true, blocking: [], headChanges: [], againstVersion: '1' });
            expect(validation.probes).toEqual([{ model: NEW_MODEL.id, provider: 'openai', turn: 'ok', tools: 'ok' }]);
            const openai = providers.find((p: any) => p.providerName === 'openai');
            expect(openai.generate).toHaveBeenCalledTimes(2);
            expect(openai.generate.mock.calls[1][0]).toMatchObject({ model: NEW_MODEL.id, tools: [expect.objectContaining({ name: 'record_probe' })] });
        });

        it('una llamada real que falla o no llama a la herramienta bloquea', async () => {
            for (const behaviour of ['error', 'no_tool'] as const) {
                const providers = ['openai', 'anthropic', 'google', 'xai', 'deepseek'].map(p => provider(p, p === 'openai' ? behaviour : 'ok'));
                const { service } = harness({ providers });
                await service.loadActive('startup');
                const draft = await service.createDraft({ reason: 'x', snapshot: edited(c => { c.models.push(NEW_MODEL as any); c.chains.conversation.push(NEW_MODEL.id); }) }, ACTOR);
                const validation = await service.validateDraft(draft.version);
                expect(validation.valid).toBe(false);
                expect(validation.blocking.some(p => p.startsWith(`probe_failed:${NEW_MODEL.id}:`))).toBe(true);
            }
        });

        it('cambiar la cabeza de una cadena sin medición bloquea, salvo «publicar sin medición»', async () => {
            const { service } = harness();
            await service.loadActive('startup');
            const draft = await service.createDraft({ reason: 'x', snapshot: edited(c => { c.chains.conversation = ['gpt-5.6-luna', ...c.chains.conversation.filter(m => m !== 'gpt-5.6-luna')]; }) }, ACTOR);
            const blocked = await service.validateDraft(draft.version);
            expect(blocked.blocking).toEqual(expect.arrayContaining([
                'measurement_missing:rehearsal_7t:gpt-5.6-luna', 'measurement_missing:signed_confirmation:gpt-5.6-luna',
            ]));
            expect(blocked.headChanges).toEqual(['chain:conversation:gpt-6-luna->gpt-5.6-luna']);
            const forced = await service.validateDraft(draft.version, { unmeasured: true });
            expect(forced).toMatchObject({ valid: true, unmeasured: true });
            expect(forced.warnings).toContain('unmeasured:measurement_missing:rehearsal_7t:gpt-5.6-luna');
            // La nueva cabeza se prueba con una llamada real aunque ya estuviera en el catálogo.
            expect(forced.probes.map(p => p.model)).toEqual(['gpt-5.6-luna']);
        });

        it('con mediciones que igualan a la cabeza, el cambio pasa sin «publicar sin medición»', async () => {
            const measurements = [
                measured('gpt-6-luna', 'rehearsal_7t', 251, 267), measured('gpt-6-luna', 'signed_confirmation', 28, 28),
                measured('gpt-6-sol', 'rehearsal_7t', 268, 276), measured('gpt-6-sol', 'signed_confirmation', 28, 28),
            ];
            const { service } = harness({ measurements });
            await service.loadActive('startup');
            const draft = await service.createDraft({ reason: 'sol mide mejor', snapshot: edited(c => {
                c.chains.tool_calling = ['gpt-6-sol', ...c.chains.tool_calling.filter(m => m !== 'gpt-6-sol')];
            }) }, ACTOR);
            const validation = await service.validateDraft(draft.version);
            expect(validation).toMatchObject({ valid: true, unmeasured: false, headChanges: ['chain:tool_calling:gpt-6-luna->gpt-6-sol'] });
            expect(validation.promotion).toEqual([
                expect.objectContaining({ bench: 'rehearsal_7t', candidate: expect.objectContaining({ model: 'gpt-6-sol', passRate: 0.971 }), head: expect.objectContaining({ model: 'gpt-6-luna', passRate: 0.9401 }) }),
                expect.objectContaining({ bench: 'signed_confirmation' }),
            ]);
        });

        it('cambiar un rol auxiliar no exige medición (no hay banco), sólo avisa', async () => {
            const { service } = harness();
            await service.loadActive('startup');
            const draft = await service.createDraft({ reason: 'x', snapshot: edited(c => { c.roles.aux_reasoning = ['gpt-5.6-luna', 'gpt-6-luna']; }) }, ACTOR);
            const validation = await service.validateDraft(draft.version);
            expect(validation).toMatchObject({ valid: true, unmeasured: false });
            expect(validation.warnings).toContain('role_head_change_without_bench:role:aux_reasoning:gpt-6-luna->gpt-5.6-luna');
        });

        it('si la tabla de mediciones no responde, el cambio cuenta como sin medición', async () => {
            const { service, measurements } = harness();
            measurements.latest.mockRejectedValueOnce(new Error('relation does not exist'));
            await service.loadActive('startup');
            const draft = await service.createDraft({ reason: 'x', snapshot: edited(c => { c.chains.classify = ['gpt-5.6-luna', ...c.chains.classify.filter(m => m !== 'gpt-5.6-luna')]; }) }, ACTOR);
            const validation = await service.validateDraft(draft.version);
            expect(validation.blocking).toContain('measurement_missing:classify_verifier:gpt-5.6-luna');
        });

        it('cada cadena necesita dos proveedores con clave (lección del 8-nov)', async () => {
            const { service } = harness({ configured: ['openai'] });
            await service.loadActive('startup');
            const draft = await service.createDraft({ reason: 'x' }, ACTOR);
            const validation = await service.validateDraft(draft.version);
            expect(validation.blocking).toEqual(expect.arrayContaining([
                'chain_configured_providers:conversation:1', 'chain_configured_providers:tool_calling:1', 'chain_configured_providers:classify:1',
            ]));
        });

        it('un modelo de familia desconocida bloquea sin gastar una llamada', async () => {
            const { service, providers } = harness();
            await service.loadActive('startup');
            const draft = await service.createDraft({ reason: 'x', snapshot: edited(c => {
                c.models.push({ ...NEW_MODEL, id: 'gpt-7-luna' } as any); c.chains.conversation.push('gpt-7-luna');
            }) }, ACTOR);
            const validation = await service.validateDraft(draft.version);
            expect(validation.blocking).toContain('unknown_family:openai:gpt-7-luna');
            expect(providers.every((p: any) => p.generate.mock.calls.length === 0)).toBe(true);
        });
    });

    describe('publicación', () => {
        it('publica en una transacción, avisa por Redis, rige en el acto y deja auditoría', async () => {
            const { service, db, redis } = harness();
            await service.loadActive('startup');
            const draft = await service.createDraft({ reason: 'gpt-6-luna baja de precio', snapshot: edited(c => {
                c.models.find(m => m.id === 'gpt-6-luna')!.costOutPer1k = 0.0004;
            }) }, ACTOR);
            const { version, validation } = await service.publish(draft.version, {}, ACTOR);
            expect(validation.valid).toBe(true);
            expect(version).toMatchObject({ version: 2, status: 'active', published_by: ACTOR.userId });
            expect(db.rows.map(r => [r.version, r.status])).toEqual([[1, 'superseded'], [2, 'active']]);
            expect(redis.store.get(LLM_CATALOG_VERSION_KEY)).toBe('2');
            expect(activeLlmCatalog().version).toBe('2');
            expect(activeLlmCatalog().models.find(m => m.id === 'gpt-6-luna')!.costOutPer1k).toBe(0.0004);
            expect(db.audit).toEqual([expect.objectContaining({ action: 'llm_catalog.published', resource: 'llm_catalog_versions/2', userId: ACTOR.userId, tenantId: null })]);
        });

        it('una validación que falla no publica nada', async () => {
            const { service, db } = harness();
            await service.loadActive('startup');
            const draft = await service.createDraft({ reason: 'x', snapshot: edited(c => { c.chains.tool_calling = ['gpt-6-luna', 'gpt-5.6-luna']; }) }, ACTOR);
            await expect(service.publish(draft.version, {}, ACTOR)).rejects.toBeInstanceOf(ConflictException);
            expect(db.rows.find(r => r.version === 1).status).toBe('active');
            expect(db.rows.find(r => r.version === 2).validation.blocking).toContain('chain_single_provider:tool_calling');
            expect(activeLlmCatalog().version).toBe('1');
        });

        it('«publicar sin medición» exige motivo y cambia el rol que usan los servicios y el hash del juez', async () => {
            const { service } = harness();
            await service.loadActive('startup');
            const hashBefore = qualityRubricHash();
            const draft = await service.createDraft({ reason: 'OpenAI caído', snapshot: edited(c => {
                c.roles.judge_quality = ['grok-4.3', 'gpt-6-luna'];
            }) }, ACTOR);
            await expect(service.publish(draft.version, { unmeasured: true }, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
            const { validation } = await service.publish(draft.version, { unmeasured: true, reason: 'emergencia: OpenAI sin créditos' }, ACTOR);
            expect(validation.unmeasured).toBe(true);
            expect(roleModel('judge_quality')).toBe('grok-4.3');
            expect(qualityRubricHash()).not.toBe(hashBefore);
        });

        it('si otro publicó entre la validación y la transacción, rechaza', async () => {
            const { service, db } = harness();
            await service.loadActive('startup');
            const draft = await service.createDraft({ reason: 'x' }, ACTOR);
            const validate = service.validate.bind(service);
            jest.spyOn(service, 'validate').mockImplementation(async (c, o) => {
                const v = await validate(c, o);
                db.rows.push({ ...db.rows[0], id: 'other', version: 99 });
                db.rows[0].status = 'superseded';
                return v;
            });
            await expect(service.publish(draft.version, {}, ACTOR)).rejects.toThrow('catalog_active_changed:1->99');
        });

        it('volver atrás publica una versión nueva con el snapshot anterior, sin exigir medición', async () => {
            const { service, db } = harness();
            await service.loadActive('startup');
            const draft = await service.createDraft({ reason: 'x', snapshot: edited(c => { c.roles.aux_cheap = ['gpt-6-luna']; }) }, ACTOR);
            await service.publish(draft.version, { unmeasured: true, reason: 'prueba' }, ACTOR);
            expect(roleModel('aux_cheap')).toBe('gpt-6-luna');
            const { version, validation } = await service.restore(1, 'el cambio empeoró los resúmenes', ACTOR);
            expect(version).toMatchObject({ version: 3, status: 'active' });
            expect(validation).toMatchObject({ valid: true, unmeasured: false, headChanges: ['role:aux_cheap:gpt-6-luna->deepseek-flash'] });
            expect(roleModel('aux_cheap')).toBe('deepseek-flash');
            expect(db.rows.map(r => r.status)).toEqual(['superseded', 'superseded', 'active']);
            await expect(service.restore(99, 'x', ACTOR)).rejects.toThrow('catalog_version_not_found:99');
        });
    });

    it('modelsToProbe: nuevos, reactivados, con cambio de proveedor o herramientas, o nuevas cabezas; nunca retirados', () => {
        const base = SEED_LLM_CATALOG;
        expect(modelsToProbe(base, base)).toEqual([]);
        const parse = (c: any) => ({ ...base, models: c.models, chains: c.chains, roles: c.roles }) as any;
        const withNew = parse(edited(c => { c.models.push(NEW_MODEL as any); c.chains.classify.push(NEW_MODEL.id); }));
        expect(modelsToProbe(base, withNew).map(m => m.id)).toEqual([NEW_MODEL.id]);
        const unreferenced = parse(edited(c => { c.models.push(NEW_MODEL as any); }));
        expect(modelsToProbe(base, unreferenced)).toEqual([]);
        const toolsChanged = parse(edited(c => { c.models.find(m => m.id === 'deepseek-flash')!.supportsTools = false; }));
        expect(modelsToProbe(base, toolsChanged).map(m => m.id)).toEqual(['deepseek-flash']);
    });
});
