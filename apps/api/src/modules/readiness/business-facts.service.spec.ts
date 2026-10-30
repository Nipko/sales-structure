import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { loadSpec } from '@parallext/business-spec/load';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
    BUSINESS_FACT_WRITTEN, BusinessFactsService, requirementValueWriteStatement, rowProvenanceStatement, type BusinessFactActor,
} from './business-facts.service';
import { ReadinessController } from './readiness.controller';
import { ReadinessInvalidationListener } from './readiness-invalidation.listener';

const TENANT = '5f7883f0-0000-4000-8000-000000000001';
const SCHEMA = 'tenant_spark_qa_dental_03_5f7883f07f09490698006a07dfe82dc7';
const spec = loadSpec();
const OWNER: BusinessFactActor = { kind: 'user', userId: '11111111-1111-4111-8111-111111111111', role: 'tenant_admin' };

/**
 * Base en memoria que interpreta la sentencia única de escritura: guarda el valor, sube la versión (o respeta
 * `expectedVersion`) y agrega la fila de versión con el actor. Así la prueba ejerce el SQL real del servicio.
 */
function fakeDb(opts: { missingTable?: boolean } = {}) {
    const values = new Map<string, Record<string, any>>();
    const versions: Record<string, any>[] = [];
    const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
        if (opts.missingTable) throw Object.assign(new Error('relation "requirement_values" does not exist'), { code: '42P01' });
        if (/^WITH written AS \(\s*INSERT INTO requirement_values/.test(sql)) {
            const [requirementId, scopeKey, value, status, origin, confirmedBy, confirmedAt, sourceRef, validUntil, specVersion, actor, expected] = params;
            const key = `${requirementId}|${scopeKey}`;
            const cur = values.get(key);
            if (cur && /DO NOTHING/.test(sql)) return [];
            if (cur && expected !== null && expected !== undefined && cur.version !== expected) return [];
            const row = {
                id: cur?.id ?? `rv-${values.size + 1}`, requirement_id: requirementId, scope_key: scopeKey, value: JSON.parse(value), status, origin,
                confirmed_by: confirmedBy, confirmed_at: confirmedAt, source_ref: sourceRef ? JSON.parse(sourceRef) : null, valid_until: validUntil,
                spec_version: specVersion, version: cur ? cur.version + 1 : 1, updated_at: '2026-10-30T12:00:00.000Z',
            };
            values.set(key, row);
            versions.push({ ...row, value_id: row.id, actor: JSON.parse(actor), created_at: '2026-10-30T12:00:00.000Z' });
            return [row];
        }
        if (/FROM requirement_values ORDER BY/.test(sql)) return [...values.values()];
        if (/FROM requirement_values WHERE requirement_id = \$1/.test(sql)) return [values.get(`${params[0]}|${params[1]}`)].filter(Boolean);
        if (/FROM requirement_value_versions WHERE/.test(sql)) return versions.filter(v => v.requirement_id === params[0] && v.scope_key === params[1]).reverse();
        throw new Error(`SQL inesperado: ${sql}`);
    });
    const prisma = { getTenantSchemaName: jest.fn(async () => SCHEMA), executeInTenantSchema };
    return { prisma, values, versions };
}

function make(opts: { missingTable?: boolean } = {}) {
    const db = fakeDb(opts);
    const readiness = { spec, invalidate: jest.fn(async () => undefined) };
    const events = { emit: jest.fn() };
    const service = new BusinessFactsService(db.prisma as any, readiness as any, events as any);
    return { db, readiness, events, service };
}

describe('BusinessFactsService.write', () => {
    it('valida, escribe la versión 1 con su actor y avisa business_fact.written', async () => {
        const { service, db, events } = make();
        const fact = await service.write(TENANT, { requirementId: 'CORE.PAYMENT.METHODS', value: { methods: ['efectivo', 'transferencia'] } }, OWNER);
        expect(fact).toMatchObject({ requirementId: 'CORE.PAYMENT.METHODS', scopeKey: '', status: 'confirmed', origin: 'owner_form', version: 1, specVersion: spec.specVersion, confirmedBy: OWNER.kind === 'user' ? OWNER.userId : null });
        expect(db.versions).toHaveLength(1);
        expect(db.versions[0]).toMatchObject({ version: 1, actor: OWNER });
        expect(events.emit).toHaveBeenCalledWith(BUSINESS_FACT_WRITTEN, { tenantId: TENANT, requirementId: 'CORE.PAYMENT.METHODS', scopeKey: '', version: 1, origin: 'owner_form' });
    });

    it('cada escritura sube la versión y deja una fila de versión (R3 #2)', async () => {
        const { service, db } = make();
        await service.write(TENANT, { requirementId: 'CORE.SAFETY.FORBIDDEN_TOPICS', value: [] }, OWNER);
        const second = await service.write(TENANT, { requirementId: 'CORE.SAFETY.FORBIDDEN_TOPICS', value: [{ topic: 'política', response: 'rechazo_breve' }] }, OWNER);
        expect(second.version).toBe(2);
        expect(db.versions.map(v => v.version)).toEqual([1, 2]);
        const history = await service.history(TENANT, 'CORE.SAFETY.FORBIDDEN_TOPICS');
        expect(history.map(h => h.version)).toEqual([2, 1]);
        expect(history[0]).toMatchObject({ actor: OWNER, valueId: second.id });
    });

    it('rechaza (400 con issues) un valor que no cumple la especificación y no escribe nada', async () => {
        const { service, db, events } = make();
        await expect(service.write(TENANT, { requirementId: 'OBJ.APPOINTMENT.WRITE_MODE', value: { mode: 'siempre' } }, OWNER)).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.write(TENANT, { requirementId: 'CORE.IDENTITY.NAME', value: { display_name: '' } }, OWNER))
            .rejects.toMatchObject({ response: { issues: [expect.objectContaining({ code: 'required', path: 'display_name' })] } });
        await expect(service.write(TENANT, { requirementId: 'OBJ.APPOINTMENT.CATALOG', value: [] }, OWNER)).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.write(TENANT, { requirementId: 'CORE.NO.EXISTE', value: {} }, OWNER)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.write(TENANT, { requirementId: 'drop table', value: {} }, OWNER)).rejects.toBeInstanceOf(BadRequestException);
        expect(db.versions).toHaveLength(0);
        expect(events.emit).not.toHaveBeenCalled();
    });

    it('los orígenes de la migración (legacy, onboarding…) no los escribe una persona', async () => {
        const { service } = make();
        await expect(service.write(TENANT, { requirementId: 'CORE.IDENTITY.NAME', value: { display_name: 'X' }, origin: 'legacy' }, OWNER))
            .rejects.toThrow(/solo lo escribe la migración/);
        await expect(service.write(TENANT, { requirementId: 'CORE.IDENTITY.NAME', value: { display_name: 'X' }, origin: 'legacy' }, { kind: 'script', name: 'backfill-provenance' }))
            .resolves.toMatchObject({ origin: 'legacy', confirmedBy: null });
    });

    it('concurrencia optimista: con expectedVersion vieja responde 409 y no escribe', async () => {
        const { service, db } = make();
        await service.write(TENANT, { requirementId: 'CORE.PAYMENT.METHODS', value: { methods: ['efectivo'] } }, OWNER);
        await service.write(TENANT, { requirementId: 'CORE.PAYMENT.METHODS', value: { methods: ['efectivo', 'Nequi'] }, expectedVersion: 1 }, OWNER);
        await expect(service.write(TENANT, { requirementId: 'CORE.PAYMENT.METHODS', value: { methods: ['PSE'] }, expectedVersion: 1 }, OWNER))
            .rejects.toBeInstanceOf(ConflictException);
        expect(db.versions).toHaveLength(2);
    });

    it('tenant sin la tabla: la lectura devuelve vacío y la escritura pide reintentar después del despliegue', async () => {
        const { service } = make({ missingTable: true });
        await expect(service.list(TENANT)).resolves.toEqual([]);
        await expect(service.get(TENANT, 'CORE.IDENTITY.NAME')).resolves.toMatchObject({ fact: null });
        await expect(service.write(TENANT, { requirementId: 'CORE.IDENTITY.NAME', value: { display_name: 'X' } }, OWNER)).rejects.toThrow(/despliegue/);
    });
});

describe('aceptación de valores por defecto (C0 §2.5)', () => {
    it('escribe origin=default_accepted con la spec_version vigente; no pisa lo configurado; rechaza ids que no son default', async () => {
        const { service, db } = make();
        await service.write(TENANT, { requirementId: 'CORE.HANDOFF.ALWAYS_HUMAN', value: { business_additions: ['descuentos'] } }, OWNER);
        const res = await service.acceptDefaults(TENANT, ['CORE.PRIVACY.CUSTOMER_MEMORY', 'CORE.HANDOFF.ALWAYS_HUMAN', 'CORE.IDENTITY.NAME'], spec.specVersion, OWNER);
        expect(res.accepted).toEqual(['CORE.PRIVACY.CUSTOMER_MEMORY']);
        expect(res.skipped.map(s => s.id)).toEqual(['CORE.HANDOFF.ALWAYS_HUMAN', 'CORE.IDENTITY.NAME']);
        expect(db.values.get('CORE.PRIVACY.CUSTOMER_MEMORY|')).toMatchObject({ origin: 'default_accepted', status: 'confirmed', value: null, spec_version: spec.specVersion });
    });

    it('con otra versión de la especificación responde 409 (hay que revisar los defaults de nuevo)', async () => {
        const { service } = make();
        await expect(service.acceptDefaults(TENANT, ['CORE.PRIVACY.CUSTOMER_MEMORY'], '0.0.1', OWNER)).rejects.toBeInstanceOf(ConflictException);
    });
});

describe('sentencias de escritura', () => {
    const base = {
        requirementId: 'CORE.IDENTITY.NAME', scopeKey: '', value: { display_name: 'X' }, status: 'confirmed' as const, origin: 'owner_form',
        confirmedBy: null, confirmedAt: null, sourceRef: null, validUntil: null, specVersion: spec.specVersion, actor: OWNER,
    };

    it('una sola sentencia escribe el valor y su versión (sin valor sin versión)', () => {
        const { sql, params } = requirementValueWriteStatement(base, 'upsert');
        expect(sql.split(';')).toHaveLength(1);
        expect(sql).toMatch(/versioned AS \(\s*INSERT INTO/);
        expect(sql).toMatch(/version = rv\.version \+ 1/);
        expect(params).toHaveLength(12);
        const once = requirementValueWriteStatement(base, 'insert_if_absent');
        expect(once.sql).toMatch(/ON CONFLICT \(requirement_id, scope_key\) DO NOTHING/);
        expect(once.params).toHaveLength(11);
    });

    it('procedencia de una fila: estampa row_updated_at, solo toca filas sin procedencia vigente y no pisa price_status heredado', () => {
        const svc = rowProvenanceStatement({ table: 'services', id: 'a', contentStatus: 'seeded', origin: 'platform_seed', priceType: 'a_cotizar', confirmedAt: null, sourceRef: { backfill: 'x', legacy_rule: 'L3', row_updated_at: null } });
        expect(svc.sql).toMatch(/row_updated_at', to_jsonb\(updated_at\)/);
        expect(svc.sql).toMatch(/WHERE id = \$1::uuid AND \(origin IS NULL OR/);
        expect(svc.sql).not.toMatch(/price_status/);
        expect(svc.sql).not.toMatch(/updated_at =/);
        const menu = rowProvenanceStatement({ table: 'menu_items', id: 'b', contentStatus: 'confirmed', origin: 'legacy_inferred', priceType: 'fijo', priceStatus: 'confirmed', confirmedAt: null, sourceRef: { backfill: 'x', legacy_rule: 'L7', row_updated_at: null } });
        expect(menu.sql).toMatch(/price_status = \$6/);
        const faq = rowProvenanceStatement({ table: 'faqs', id: 'c', contentStatus: 'seeded', origin: 'platform_seed', priceType: null, confirmedAt: null, sourceRef: { backfill: 'x', legacy_rule: 'L3', row_updated_at: null } });
        expect(faq.sql).not.toMatch(/price_/);
        expect(() => rowProvenanceStatement({ ...faq, table: 'users' } as any)).toThrow(/sin columnas/);
    });
});

describe('invalidación y controlador', () => {
    it('business_fact.written invalida la caché de la preparación', async () => {
        const readiness = { invalidate: jest.fn(async () => undefined) };
        await new ReadinessInvalidationListener(readiness as any).onAgentChanged({ tenantId: TENANT });
        expect(readiness.invalidate).toHaveBeenCalledWith(TENANT);
        const handlers = Reflect.getMetadataKeys(ReadinessInvalidationListener.prototype.onAgentChanged);
        expect(handlers.length).toBeGreaterThan(0);
    });

    const roles = (method: keyof ReadinessController) => Reflect.getMetadata(ROLES_KEY, ReadinessController.prototype[method]);

    it('escribir es del dueño; leer, del dueño y el supervisor', () => {
        expect(roles('writeFact')).toEqual(['super_admin', 'tenant_admin']);
        expect(roles('acceptDefaults')).toEqual(['super_admin', 'tenant_admin']);
        for (const m of ['listFacts', 'getFact', 'factVersions'] as const) expect(roles(m)).toEqual(['super_admin', 'tenant_admin', 'tenant_supervisor']);
    });

    it('PUT escribe como owner_form y devuelve el delta; la plataforma sin suplantación no escribe', async () => {
        const facts = { write: jest.fn(async () => ({ requirementId: 'CORE.PAYMENT.METHODS', version: 1 })) };
        const readiness = {
            currentVerdict: jest.fn(async () => 'no_listo'),
            evaluateTenant: jest.fn(async () => ({ result: { verdict: 'limitado', requirements: [{ id: 'CORE.PAYMENT.METHODS', result: 'cumple' }] } })),
        };
        const controller = new ReadinessController(readiness as any, facts as any);
        const req = { user: { id: OWNER.kind === 'user' ? OWNER.userId : '', role: 'tenant_admin' } };
        const res = await controller.writeFact(TENANT, 'CORE.PAYMENT.METHODS', { value: { methods: ['efectivo'] } }, req);
        expect(facts.write).toHaveBeenCalledWith(TENANT, { requirementId: 'CORE.PAYMENT.METHODS', value: { methods: ['efectivo'] }, scopeKey: '', expectedVersion: undefined },
            { kind: 'user', userId: req.user.id, role: 'tenant_admin' });
        expect(res.data.readiness).toEqual({ verdictBefore: 'no_listo', verdictAfter: 'limitado', requirement: { id: 'CORE.PAYMENT.METHODS', result: 'cumple' } });
        await expect(controller.writeFact(TENANT, 'X', {} as any, req)).rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.writeFact(TENANT, 'CORE.PAYMENT.METHODS', { value: 1 }, { user: { id: 'sa', role: 'super_admin' } })).rejects.toBeInstanceOf(ForbiddenException);
        const imp = { user: { id: 'tu', role: 'tenant_admin', isImpersonation: true, impersonatedBy: 'sa-real', impersonationSid: 'sid' } };
        await controller.writeFact(TENANT, 'CORE.PAYMENT.METHODS', { value: { methods: ['efectivo'] } }, imp);
        expect(facts.write).toHaveBeenLastCalledWith(TENANT, expect.anything(), expect.objectContaining({ delegation: expect.objectContaining({ performedBy: 'sa-real' }) }));
    });
});
