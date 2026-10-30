/**
 * R3b (C0 §2.3 y §5 R3b, ADR 0009): BusinessFactsReader (lo que lee el agente) y la escritura doble de
 * BusinessFactsService (expand: el valor nuevo y su proyección al almacenamiento de hoy, en una transacción).
 *
 * La base en memoria interpreta las sentencias reales: la del valor (`requirementValueWriteStatement`) y las de la
 * proyección (`legacyPatchStatements`), y deshace todo si la transacción falla.
 */
import { ConflictException } from '@nestjs/common';
import { loadSpec } from '@parallext/business-spec/load';
import { BusinessFactsCacheListener } from './business-facts-cache.listener';
import { BusinessFactsReader, applyIdentityOverlay, businessFactSourcesCacheKey, renderNotOfferedEntry } from './business-facts.reader';
import { BUSINESS_FACT_WRITTEN, BusinessFactsService, type BusinessFactActor } from './business-facts.service';

const TENANT = '5f7883f0-0000-4000-8000-000000000001';
const SCHEMA = 'tenant_spark_qa_dental_03_5f7883f07f09490698006a07dfe82dc7';
const spec = loadSpec();
const OWNER: BusinessFactActor = { kind: 'user', userId: '11111111-1111-4111-8111-111111111111', role: 'tenant_admin' };

const LEGACY_HOURS = {
    is247: false, timezone: 'America/Bogota', afterHoursMessage: 'Te respondemos mañana.',
    schedule: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        .map((d, i) => [d, { enabled: i < 5, open: '08:00', close: '18:00' }])),
};

type Row = Record<string, any>;
interface State {
    tenant: Row;
    companies: Row[];
    policies: Row[];
    rv: Map<string, Row>;
    personasVersion: number;
}

function initial(): State {
    return {
        tenant: { ref: TENANT, slug: 'spark-qa-dental-03', name: 'Spark QA Dental', created_at: '2026-10-01T00:00:00.000Z', operating_country: 'CO', operating_timezone: 'America/Bogota', schema_name: SCHEMA, settings: { businessHours: LEGACY_HOURS, customerTypes: ['b2c'] } },
        companies: [{ id: 'c1', name: 'Spark QA Dental', about: 'Consultorio de prueba.', address: 'Calle 1', city: 'Bogotá', country: 'CO', phone: '+5710000000', email: 'qa@dental.co', website: null, social_links: {}, is_primary: true, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }],
        policies: [{ id: 'p1', type: 'cancellation', title: 'Cancelaciones', content: 'Cancela gratis hasta 24 h antes.', version: 2, is_active: true }],
        rv: new Map(),
        personasVersion: 1,
    };
}

/** Interpreta las sentencias del lector, del valor y de la proyección sobre `state`. */
function apply(state: State, sql: string, params: any[] = []): Row[] {
    if (/FROM public\.tenants WHERE id = \$1::uuid/.test(sql) && /^SELECT/.test(sql.trim())) return [{ ...state.tenant, settings: JSON.parse(JSON.stringify(state.tenant.settings)) }];
    if (/FROM companies ORDER BY is_primary/.test(sql)) return state.companies.slice(0, 1).map(c => ({ ...c }));
    if (/FROM policies WHERE is_active = true/.test(sql)) return state.policies.filter(p => p.is_active).map(p => ({ ...p }));
    if (/FROM requirement_values WHERE requirement_id = ANY/.test(sql)) return [...state.rv.values()].filter(r => params[0].includes(r.requirement_id)).map(r => ({ ...r }));
    if (/jsonb_build_object\('businessHours'/.test(sql)) { state.tenant.settings = { ...state.tenant.settings, businessHours: JSON.parse(params[1]) }; return [{ id: TENANT }]; }
    if (/jsonb_build_object\('customerTypes'/.test(sql)) { state.tenant.settings = { ...state.tenant.settings, customerTypes: JSON.parse(params[1]) }; return [{ id: TENANT }]; }
    if (/^UPDATE public\.tenants SET name/.test(sql)) { state.tenant.name = params[1]; return [{ id: TENANT }]; }
    if (/^UPDATE agent_personas/.test(sql)) { state.personasVersion++; return [{ id: 'a1' }]; }
    if (/UPDATE companies SET/.test(sql)) {
        const cols = [...sql.matchAll(/(\w+) = \$(\d+)/g)].filter(m => Number(m[2]) >= 2).map(m => [m[1], Number(m[2])] as const);
        const main = state.companies.find(c => c.is_primary);
        if (!main) { state.companies.push({ id: 'c-new', name: state.tenant.name, is_primary: true }); }
        const target = state.companies.find(c => c.is_primary)!;
        for (const [col, i] of cols) target[col] = col === 'social_links' ? JSON.parse(params[i - 1]) : params[i - 1];
        return [{ id: target.id }];
    }
    if (/^UPDATE policies SET is_active = false/.test(sql)) { for (const p of state.policies) if (p.type === params[0] && p.is_active) p.is_active = false; return []; }
    if (/^INSERT INTO policies/.test(sql)) {
        const version = Math.max(0, ...state.policies.filter(p => p.type === params[0]).map(p => p.version)) + 1;
        state.policies.push({ id: `p-${state.policies.length + 1}`, type: params[0], title: params[1], content: params[2], version, is_active: true, created_by: params[3] });
        return [{ id: 'p-new' }];
    }
    if (/^WITH written AS \(\s*INSERT INTO requirement_values/.test(sql)) {
        const [requirementId, scopeKey, value, status, origin, confirmedBy, confirmedAt, sourceRef, validUntil, specVersion, , expected] = params;
        const key = `${requirementId}|${scopeKey}`;
        const cur = state.rv.get(key);
        if (cur && expected !== null && expected !== undefined && cur.version !== expected) return [];
        const row = {
            id: cur?.id ?? `rv-${state.rv.size + 1}`, requirement_id: requirementId, scope_key: scopeKey, value: JSON.parse(value), status, origin,
            confirmed_by: confirmedBy, confirmed_at: confirmedAt, source_ref: sourceRef ? JSON.parse(sourceRef) : null, valid_until: validUntil,
            spec_version: specVersion, version: cur ? cur.version + 1 : 1, updated_at: '2026-10-30T12:00:00.000Z',
        };
        state.rv.set(key, row);
        return [row];
    }
    if (/information_schema\.tables/.test(sql)) return [{ '?column?': 1 }];
    throw new Error(`SQL inesperado: ${sql}`);
}

function make(opts: { redis?: boolean } = {}) {
    const box = { state: initial() };
    const cache = new Map<string, unknown>();
    const redis = opts.redis ? {
        getJson: jest.fn(async (k: string) => (cache.has(k) ? JSON.parse(JSON.stringify(cache.get(k))) : null)),
        setJson: jest.fn(async (k: string, v: unknown) => { cache.set(k, v); }),
        del: jest.fn(async (k: string) => { cache.delete(k); }),
    } : undefined;
    const prisma = {
        getTenantSchemaName: jest.fn(async () => SCHEMA),
        $queryRawUnsafe: jest.fn(async (sql: string, ...params: any[]) => apply(box.state, sql, params)),
        executeInTenantSchema: jest.fn(async (_s: string, sql: string, params: any[] = []) => apply(box.state, sql, params)),
        transactionInTenantSchema: jest.fn(async (_s: string, fn: (q: (sql: string, params?: any[]) => Promise<any>) => Promise<any>) => {
            const draft: State = { ...JSON.parse(JSON.stringify({ ...box.state, rv: [...box.state.rv.entries()] })) };
            draft.rv = new Map(draft.rv as unknown as [string, Row][]);
            const out = await fn(async (sql, params = []) => apply(draft, sql, params));
            box.state = draft; // commit solo si no lanzó
            return out;
        }),
    };
    const reader = new BusinessFactsReader(prisma as any, redis as any);
    const readiness = { spec, invalidate: jest.fn(async () => undefined) };
    const events = { emit: jest.fn() };
    const service = new BusinessFactsService(prisma as any, readiness as any, events as any, reader);
    return { box, prisma, reader, service, events, redis, cache };
}

const WEEK = {
    timezone: 'America/Bogota', always_open: false,
    days: { mon: [{ open: '08:00', close: '12:00' }, { open: '14:00', close: '18:00' }], tue: [{ open: '09:00', close: '17:00' }], wed: [], thu: [], fri: [], sat: [], sun: [] },
};

describe('BusinessFactsReader: precedencia (ADR 0007 §2, ADR 0009)', () => {
    it('sin valores del dueño el agente lee el almacenamiento de hoy tal cual', async () => {
        const { reader } = make();
        expect(await reader.hours(TENANT)).toEqual(LEGACY_HOURS);
        expect(await reader.policy(TENANT, 'cancellation')).toEqual({ type: 'cancellation', title: 'Cancelaciones', content: 'Cancela gratis hasta 24 h antes.', version: 2, source: 'legacy', id: 'p1' });
        expect(await reader.policy(TENANT, 'terms')).toBeNull();
        expect(await reader.notOffered(TENANT)).toBeNull();
        const base = { id: 'c1', tenantId: TENANT, companyName: 'Spark QA Dental', isPrimary: true, createdAt: new Date(), updatedAt: new Date() };
        expect(await reader.identity(TENANT, base)).toBe(base);
    });

    it('una fila migrada con su fuente intacta no cambia lo que lee el agente', async () => {
        const { reader, box } = make();
        box.state.rv.set('CORE.HOURS.REGULAR|', {
            id: 'rv-m', requirement_id: 'CORE.HOURS.REGULAR', scope_key: '', status: 'confirmed', origin: 'legacy', version: 1,
            value: { always_open: false, timezone: 'America/Bogota', days: {} },
            source_ref: { backfill: 'backfill-provenance@1', migrated_from: 'settings.businessHours', migrated_hash: 'x' },
        });
        expect(await reader.hours(TENANT)).toEqual(LEGACY_HOURS);
    });

    it('si falta una tabla del tenant (sin migrar), cuenta como vacía', async () => {
        const { reader, prisma } = make();
        prisma.executeInTenantSchema.mockImplementation(async () => { throw Object.assign(new Error('relation "requirement_values" does not exist'), { code: '42P01' }); });
        expect(await reader.hours(TENANT)).toEqual(LEGACY_HOURS);
        expect(await reader.policy(TENANT, 'cancellation')).toBeNull();
    });
});

describe('BusinessFactsService.write: escritura doble (expand, R3b)', () => {
    it('horario: escribe settings.businessHours y el valor con projected_to/hash en una transacción; el agente lee el valor', async () => {
        const { service, reader, box, events, prisma } = make();
        const fact = await service.write(TENANT, { requirementId: 'CORE.HOURS.REGULAR', value: WEEK }, OWNER);
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(fact.sourceRef).toMatchObject({ projected_to: 'settings.businessHours', projected_hash: expect.any(String) });
        // la pantalla vieja ve el envolvente; el mensaje fuera de horario de la cuenta se conserva
        expect(box.state.tenant.settings.businessHours).toMatchObject({ is247: false, timezone: 'America/Bogota', afterHoursMessage: 'Te respondemos mañana.' });
        expect(box.state.tenant.settings.businessHours.schedule.monday).toEqual({ enabled: true, open: '08:00', close: '18:00' });
        expect(box.state.personasVersion).toBe(2);
        const hours = await reader.hours(TENANT);
        expect(hours?.schedule.monday.windows).toEqual(WEEK.days.mon);
        expect(hours?.schedule.wednesday.enabled).toBe(false);
        expect(events.emit).toHaveBeenCalledWith(BUSINESS_FACT_WRITTEN, expect.objectContaining({ requirementId: 'CORE.HOURS.REGULAR', projectedTo: 'settings.businessHours' }));
    });

    it('si una pantalla vieja edita el horario después, el agente lee la edición', async () => {
        const { service, reader, box } = make();
        await service.write(TENANT, { requirementId: 'CORE.HOURS.REGULAR', value: WEEK }, OWNER);
        box.state.tenant.settings.businessHours = { ...LEGACY_HOURS, is247: true };
        expect(await reader.hours(TENANT)).toEqual({ ...LEGACY_HOURS, is247: true });
    });

    it('409 por versión vieja: no queda ni el valor ni la proyección', async () => {
        const { service, box } = make();
        await service.write(TENANT, { requirementId: 'CORE.HOURS.REGULAR', value: WEEK }, OWNER);
        const before = JSON.stringify(box.state.tenant.settings.businessHours);
        await expect(service.write(TENANT, { requirementId: 'CORE.HOURS.REGULAR', value: { ...WEEK, always_open: true }, expectedVersion: 7 }, OWNER))
            .rejects.toBeInstanceOf(ConflictException);
        expect(JSON.stringify(box.state.tenant.settings.businessHours)).toBe(before);
        expect(box.state.rv.get('CORE.HOURS.REGULAR|')?.version).toBe(1);
    });

    it('política: versión nueva activa en `policies` con el mismo texto que devuelve get_policy', async () => {
        const { service, reader, box } = make();
        const value = { cancel: { deadline: { min: 12, unit: 'h' }, charge: 'ninguno' }, summary: 'Cancela sin costo con 12 h.' };
        await service.write(TENANT, { requirementId: 'CORE.POLICY.CANCELLATION_CHANGES', value }, OWNER);
        const active = box.state.policies.filter(p => p.type === 'cancellation' && p.is_active);
        expect(active).toHaveLength(1);
        expect(active[0]).toMatchObject({ version: 3, created_by: `business-facts:${OWNER.kind === 'user' ? OWNER.userId : ''}` });
        const p = await reader.policy(TENANT, 'cancellation');
        expect(p).toMatchObject({ source: 'requirement_values', content: active[0].content, terms: { cancel: value.cancel } });
        expect(p?.content).toMatch(/^Cancela sin costo con 12 h\.\n/);
    });

    it('identidad: tenants.name y companies como proyección; el agente ve lo que declaró el dueño', async () => {
        const { service, reader, box } = make();
        await service.write(TENANT, { requirementId: 'CORE.IDENTITY.NAME', value: { display_name: 'Sonrisa Dental' } }, OWNER);
        await service.write(TENANT, { requirementId: 'CORE.CONTACT.CHANNELS', value: [{ kind: 'phone', value: '+5716011234' }, { kind: 'email', value: 'citas@sonrisa.co' }] }, OWNER);
        expect(box.state.tenant.name).toBe('Sonrisa Dental');
        expect(box.state.companies[0]).toMatchObject({ phone: '+5716011234', email: 'citas@sonrisa.co' });
        const base = { id: 'c1', tenantId: TENANT, companyName: 'Spark QA Dental', phone: '+5710000000', isPrimary: true, createdAt: new Date(), updatedAt: new Date() };
        expect(await reader.identity(TENANT, base)).toMatchObject({ companyName: 'Sonrisa Dental', phone: '+5716011234', email: 'citas@sonrisa.co' });
    });

    it('not_offered no tiene almacenamiento viejo: se escribe sin transacción ni proyección', async () => {
        const { service, reader, prisma } = make();
        const fact = await service.write(TENANT, { requirementId: 'CORE.OFFER.NOT_OFFERED', value: [{ item: 'ortodoncia invisible', alternative: 'brackets estéticos' }] }, OWNER);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        expect(fact.sourceRef).toBeNull();
        const list = await reader.notOffered(TENANT);
        expect(list?.map(renderNotOfferedEntry)).toEqual(['ortodoncia invisible (alternative: brackets estéticos)']);
    });

    it('la migración (origen legacy) nunca proyecta', async () => {
        const { service, prisma } = make();
        await service.write(TENANT, { requirementId: 'CORE.HOURS.REGULAR', value: WEEK, origin: 'legacy' }, { kind: 'script', name: 'backfill-provenance' });
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });
});

describe('cachés', () => {
    it('las fuentes se guardan 60 s salvo para políticas; business_fact.written las invalida', async () => {
        const { reader, redis, cache } = make({ redis: true });
        await reader.hours(TENANT);
        expect(cache.has(businessFactSourcesCacheKey(TENANT))).toBe(true);
        await reader.policy(TENANT, 'cancellation');
        expect(redis!.getJson).toHaveBeenCalledTimes(1);
        const listener = new BusinessFactsCacheListener(redis as any);
        await listener.onWritten({ tenantId: TENANT, requirementId: 'CORE.HOURS.REGULAR', scopeKey: '', version: 1, origin: 'owner_form' });
        expect(redis!.del).toHaveBeenCalledWith(businessFactSourcesCacheKey(TENANT));
        expect(redis!.del).toHaveBeenCalledWith(`biz_hours:${TENANT}`);
        expect(redis!.del).toHaveBeenCalledWith(`business-info:${TENANT}:primary`);
    });

    it('applyIdentityOverlay sin valores devuelve la misma identidad', () => {
        expect(applyIdentityOverlay(null, {}, TENANT)).toBeNull();
    });
});
