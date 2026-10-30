/**
 * R3b (C0 §2.3 y §5 R3b, ADR 0009): lo que el agente lee del negocio sale de `requirement_values` con la misma regla que
 * la foto del motor.
 *
 * - Equivalencia: en los 7 tenants QA (tal cual y con horario y políticas cargados en el almacenamiento viejo), antes y
 *   después de la migración, el agente lee exactamente lo mismo que leía (horario, políticas, identidad, not_offered) y
 *   el veredicto del motor no cambia.
 * - Precedencia: valor del dueño > almacenamiento viejo; un valor migrado nunca reemplaza la fuente que copió; un valor
 *   proyectado manda solo mientras su proyección siga intacta (si una pantalla vieja la editó, manda la pantalla), en el
 *   agente y en el motor a la vez.
 */
import { applyBackfillPlan, planProvenanceBackfill } from '../src/backfill';
import {
    applyLegacyPatch, factSnapshot, hoursToRuntime, projectToLegacy, projectionInSync, renderPolicyText, resolveBusinessHours,
    resolveIdentity, resolveNotOffered, resolvePolicy, type FactSources, type LegacyPatch,
} from '../src/business-facts';
import { evaluate } from '../src/engine/evaluate';
import { fromLegacyRows, type LegacyTenantRows } from '../src/legacy-status';
import { isIsoDuration, validateRequirementValue } from '../src/validate-value';
import { NOW, fixtureRows, spec } from './helpers';

type Row = Record<string, any>;

const QA = [
    'agencia-qa-viajes', 'inmobiliaria-qa', 'salon-qa-citas', 'spark-qa-comida-04', 'spark-qa-dental-03', 'spark-qa-hotel-09',
    'tienda-qa-electronica',
];

const LEGACY_HOURS = {
    is247: false, timezone: 'America/Bogota', afterHoursMessage: 'Te respondemos mañana a primera hora.',
    schedule: {
        monday: { enabled: true, open: '08:00', close: '18:00' }, tuesday: { enabled: true, open: '08:00', close: '18:00' },
        wednesday: { enabled: true, open: '08:00', close: '18:00' }, thursday: { enabled: true, open: '08:00', close: '18:00' },
        friday: { enabled: true, open: '08:00', close: '17:00' }, saturday: { enabled: true, open: '09:00', close: '13:00' },
        sunday: { enabled: false, open: '09:00', close: '13:00' },
    },
};
const AT = '2026-10-20T10:00:00.000Z';
const LEGACY_POLICIES = [
    { id: 'p-cancel', type: 'cancellation', title: 'Cancelaciones', content: 'Cancela gratis hasta 24 h antes.', version: 3, is_active: true, created_at: AT, updated_at: AT },
    { id: 'p-old', type: 'cancellation', title: 'Cancelaciones', content: 'Versión vieja.', version: 2, is_active: false, created_at: AT, updated_at: AT },
    { id: 'p-priv', type: 'privacy', title: 'Privacidad', content: 'Tratamos tus datos según la ley 1581.', version: 1, is_active: true, created_at: AT, updated_at: AT },
];

/** El tenant QA con horario y políticas en el almacenamiento viejo (lo que tienen varios tenants de producción). */
function loaded(slug: string): LegacyTenantRows {
    const rows = fixtureRows(slug);
    rows.tenant.settings = { ...rows.tenant.settings, businessHours: LEGACY_HOURS };
    rows.policies = LEGACY_POLICIES.map(p => ({ ...p }));
    return rows;
}

const migrate = (rows: LegacyTenantRows) => applyBackfillPlan(rows, planProvenanceBackfill(spec, rows, { now: NOW }));

/** Lo que carga `BusinessFactsReader` de un tenant. */
const sourcesOf = (rows: LegacyTenantRows): FactSources => ({
    tenant: {
        ref: rows.tenant.ref, slug: rows.tenant.slug, name: rows.tenant.name, created_at: rows.tenant.created_at, settings: rows.tenant.settings,
        operating_country: rows.tenant.operating_country, operating_timezone: rows.tenant.operating_timezone,
    },
    companies: [rows.companies.find(c => c.is_primary) ?? rows.companies[0]].filter(Boolean),
    policies: rows.policies.filter(p => p.is_active !== false),
    requirement_values: rows.requirement_values ?? [],
});

/** Lo que ve el agente: horario, las 5 políticas, la identidad y not_offered. */
const agentView = (rows: LegacyTenantRows) => {
    const src = sourcesOf(rows);
    const snap = factSnapshot(src);
    return {
        hours: resolveBusinessHours(src, snap).hours,
        policies: ['cancellation', 'return', 'warranty', 'privacy', 'shipping', 'terms'].map(t => {
            const p = resolvePolicy(src, t, snap);
            return p && { type: p.type, title: p.title, content: p.content, version: p.version, source: p.source };
        }),
        identity: resolveIdentity(src, snap).overlay,
        notOffered: resolveNotOffered(src, snap),
    };
};

/** Escribe la proyección en las filas del tenant como lo hace la API (misma transacción que el valor). */
function writeLegacy(rows: LegacyTenantRows, patch: LegacyPatch): LegacyTenantRows {
    const copy: LegacyTenantRows = JSON.parse(JSON.stringify(rows));
    const after = applyLegacyPatch(sourcesOf(copy), patch);
    copy.tenant.settings = after.tenant.settings ?? {};
    copy.tenant.name = after.tenant.name;
    if (patch.kind === 'companies') {
        const main = copy.companies.find(c => c.is_primary) ?? copy.companies[0];
        Object.assign(main, patch.fields, { updated_at: NOW.toISOString() });
    }
    if (patch.kind === 'policies') {
        for (const p of copy.policies) if (p.type === patch.type) p.is_active = false;
        copy.policies.push({ id: `p-${patch.type}-new`, type: patch.type, title: patch.title, content: patch.content, version: 9, is_active: true, created_at: NOW.toISOString(), updated_at: NOW.toISOString() });
    }
    return copy;
}

/** `BusinessFactsService.write()` con proyección: almacenamiento viejo + fila del dueño con `projected_to/projected_hash`. */
function ownerWrite(rows: LegacyTenantRows, requirementId: string, value: unknown, version = 1): LegacyTenantRows {
    const projection = projectToLegacy(requirementId, value, sourcesOf(rows));
    const next = projection ? writeLegacy(rows, projection.patch) : JSON.parse(JSON.stringify(rows)) as LegacyTenantRows;
    next.requirement_values = [
        ...(next.requirement_values ?? []).filter(r => !(r.requirement_id === requirementId && r.scope_key === '')),
        {
            id: `rv-${requirementId}`, requirement_id: requirementId, scope_key: '', value, status: 'confirmed', origin: 'owner_form',
            confirmed_by: null, confirmed_at: NOW.toISOString(), valid_until: null, spec_version: spec.specVersion, version,
            source_ref: projection ? { projected_to: projection.storage, projected_hash: projection.hash } : null,
        },
    ];
    return next;
}

const verdictOf = (rows: LegacyTenantRows) => evaluate(spec, fromLegacyRows(rows), NOW);

describe('lo que lee el agente: equivalencia antes y después de la migración (R3b #3)', () => {
    it.each(QA)('%s: mismo horario, políticas, identidad y not_offered; mismo veredicto', slug => {
        for (const before of [fixtureRows(slug), loaded(slug)]) {
            const after = migrate(before);
            expect((after.requirement_values ?? []).length).toBeGreaterThan(0);
            expect(agentView(after)).toEqual(agentView(before));
            expect(verdictOf(after).resultHash).toBe(verdictOf(before).resultHash);
            // sin valores del dueño el agente lee el almacenamiento viejo tal cual
            const view = agentView(after);
            expect(view.hours).toEqual(before.tenant.settings.businessHours ?? null);
            expect(view.identity).toEqual({});
            expect(view.notOffered).toBeNull();
        }
    });

    it('con políticas en la tabla vieja, get_policy devuelve la fila activa (también después de migrarla)', () => {
        const after = migrate(loaded('spark-qa-dental-03'));
        const src = sourcesOf(after);
        expect(resolvePolicy(src, 'cancellation')).toEqual({
            type: 'cancellation', title: 'Cancelaciones', content: 'Cancela gratis hasta 24 h antes.', version: 3, source: 'legacy', id: 'p-cancel',
        });
        expect(resolvePolicy(src, 'warranty')).toBeNull();
        // la migración sí copió la política a requirement_values (texto en summary)
        expect(after.requirement_values?.find(r => r.requirement_id === 'CORE.POLICY.CANCELLATION_CHANGES')?.value)
            .toEqual({ summary: 'Cancela gratis hasta 24 h antes.', title: 'Cancelaciones' });
    });
});

describe('precedencia del lector (ADR 0007 §2, ADR 0009)', () => {
    const WEEK = {
        timezone: 'America/Bogota', always_open: false,
        days: { mon: [{ open: '08:00', close: '12:00' }, { open: '14:00', close: '18:00' }], tue: [{ open: '08:00', close: '18:00' }], wed: [], thu: [], fri: [], sat: [], sun: [] },
    };

    it('un valor del dueño proyectado manda en el agente y en el motor, con todos sus tramos', () => {
        const before = migrate(loaded('spark-qa-dental-03'));
        const after = ownerWrite(before, 'CORE.HOURS.REGULAR', WEEK, 2);
        const src = sourcesOf(after);
        const r = resolveBusinessHours(src);
        expect(r.source).toBe('requirement_values');
        expect(r.hours?.schedule.monday).toEqual({ enabled: true, open: '08:00', close: '18:00', windows: [{ open: '08:00', close: '12:00' }, { open: '14:00', close: '18:00' }] });
        expect(r.hours?.schedule.wednesday.enabled).toBe(false);
        expect(r.hours?.afterHoursMessage).toBe(LEGACY_HOURS.afterHoursMessage);
        // dual write: la pantalla vieja ve el envolvente (un tramo por día) y la proyección quedó intacta
        expect(after.tenant.settings.businessHours.schedule.monday).toEqual({ enabled: true, open: '08:00', close: '18:00' });
        expect(projectionInSync(src, after.requirement_values!.find(x => x.requirement_id === 'CORE.HOURS.REGULAR')!)).toBe(true);
        // el motor lee el mismo valor: un solo registro, el del dueño (la persona y la fuente vieja ya no cuentan)
        const recs = fromLegacyRows(after).values['CORE.HOURS.REGULAR'];
        expect(recs).toHaveLength(1);
        expect(recs[0]).toMatchObject({ storage: 'requirement_values', origin: 'owner_form', value: WEEK });
    });

    it('si una pantalla vieja edita el almacenamiento después, manda la pantalla (agente y motor)', () => {
        const written = ownerWrite(migrate(loaded('salon-qa-citas')), 'CORE.HOURS.REGULAR', WEEK);
        const edited: LegacyTenantRows = JSON.parse(JSON.stringify(written));
        edited.tenant.settings.businessHours = { ...LEGACY_HOURS, is247: true };
        const src = sourcesOf(edited);
        expect(projectionInSync(src, edited.requirement_values!.find(x => x.requirement_id === 'CORE.HOURS.REGULAR')!)).toBe(false);
        expect(resolveBusinessHours(src)).toMatchObject({ source: 'legacy', hours: { is247: true } });
        const snap = fromLegacyRows(edited);
        expect(snap.values['CORE.HOURS.REGULAR'].some(r => r.storage === 'requirement_values')).toBe(false);
        expect(snap.values['CORE.HOURS.REGULAR'].some(r => r.storage === 'settings.businessHours')).toBe(true);
        expect(snap.source.notes?.join(' ')).toMatch(/ignorados/);
    });

    it('un valor sin proyección (escrito en R3) manda sobre todo lo heredado', () => {
        const rows = migrate(loaded('spark-qa-hotel-09'));
        rows.requirement_values = [...(rows.requirement_values ?? []).filter(r => r.requirement_id !== 'CORE.HOURS.REGULAR'), {
            id: 'rv-h', requirement_id: 'CORE.HOURS.REGULAR', scope_key: '', value: { ...WEEK, always_open: true }, status: 'confirmed', origin: 'owner_form',
            confirmed_by: null, confirmed_at: NOW.toISOString(), source_ref: null, valid_until: null, spec_version: spec.specVersion, version: 1,
        }];
        const r = resolveBusinessHours(sourcesOf(rows));
        expect(r).toMatchObject({ source: 'requirement_values', hours: { is247: true, timezone: 'America/Bogota' } });
    });

    it('un valor migrado nunca se lee como valor del dueño: si su fuente cambió, el agente lee la fuente', () => {
        const rows = migrate(loaded('tienda-qa-electronica'));
        rows.tenant.settings.businessHours = { ...LEGACY_HOURS, timezone: 'America/Lima' };
        const r = resolveBusinessHours(sourcesOf(rows));
        expect(r).toEqual({ source: 'legacy', hours: rows.tenant.settings.businessHours, fact: null });
    });

    it('el mensaje fuera de horario del dueño (HOURS_SLA) reemplaza al de la cuenta', () => {
        const rows = ownerWrite(migrate(loaded('salon-qa-citas')), 'CORE.HANDOFF.HOURS_SLA', {
            sla_in_hours: { min: 15, unit: 'min' }, sla_out_of_hours: 'PT4H', out_of_hours_message: 'Te escribimos apenas abramos.',
        });
        expect(resolveBusinessHours(sourcesOf(rows)).hours).toEqual({ ...LEGACY_HOURS, afterHoursMessage: 'Te escribimos apenas abramos.' });
    });

    it('políticas: el valor estructurado del dueño se proyecta a `policies` y get_policy devuelve el mismo texto', () => {
        const value = { cancel: { deadline: { min: 24, unit: 'h' }, charge: 'ninguno' }, no_show: { charge: '50%' }, summary: 'Puedes cancelar sin costo.' };
        const rows = ownerWrite(migrate(loaded('spark-qa-dental-03')), 'CORE.POLICY.CANCELLATION_CHANGES', value, 4);
        const p = resolvePolicy(sourcesOf(rows), 'cancellation');
        expect(p).toMatchObject({ source: 'requirement_values', version: 4, title: 'Política de cancelación y cambios', terms: { cancel: value.cancel, no_show: value.no_show } });
        expect(p?.content).toBe(renderPolicyText(value));
        expect(p?.content).toContain('Puedes cancelar sin costo.');
        expect(p?.content).toContain('Plazo: 24 h');
        // la fila activa de `policies` (consentimientos, pantalla vieja) dice lo mismo
        expect(rows.policies.find(x => x.type === 'cancellation' && x.is_active)?.content).toBe(p?.content);
        // el motor ve el valor del dueño, no el texto viejo
        expect(fromLegacyRows(rows).values['CORE.POLICY.CANCELLATION_CHANGES']).toHaveLength(1);
    });

    it('not_offered: solo un valor confirmado del dueño cuenta; [] es «nada», sin valor es null', () => {
        const base = migrate(loaded('spark-qa-dental-03'));
        expect(resolveNotOffered(sourcesOf(base))).toBeNull();
        const none = ownerWrite(base, 'CORE.OFFER.NOT_OFFERED', []);
        expect(resolveNotOffered(sourcesOf(none))).toEqual([]);
        const some = ownerWrite(base, 'CORE.OFFER.NOT_OFFERED', [{ item: 'ortodoncia invisible', alternative: 'brackets estéticos' }, { item: 'blanqueamiento', reason: 'sin equipo' }]);
        expect(resolveNotOffered(sourcesOf(some))).toEqual([{ item: 'ortodoncia invisible', alternative: 'brackets estéticos' }, { item: 'blanqueamiento', reason: 'sin equipo' }]);
        expect(projectToLegacy('CORE.OFFER.NOT_OFFERED', [], sourcesOf(base))).toBeNull();
    });

    it('identidad: nombre, descripción, sede y contacto del dueño; tenants.name y companies como proyección', () => {
        let rows = migrate(loaded('salon-qa-citas'));
        rows = ownerWrite(rows, 'CORE.IDENTITY.NAME', { display_name: 'Salón Aurora' });
        rows = ownerWrite(rows, 'CORE.IDENTITY.DESCRIPTION', { short: 'Salón de belleza en Chapinero: cortes, color y peinados para toda la familia.', audience: ['B2C'] });
        rows = ownerWrite(rows, 'CORE.LOCATIONS.LIST', { modality: ['presencial'], locations: [{ name: 'Sede norte', is_main: true, address: { line1: 'Cra 13 #63-21', city: 'Bogotá', country: 'CO' } }] });
        rows = ownerWrite(rows, 'CORE.CONTACT.CHANNELS', [{ kind: 'phone', value: '+5716011234' }, { kind: 'email', value: 'hola@aurora.co' }]);
        const { overlay } = resolveIdentity(sourcesOf(rows));
        expect(overlay).toMatchObject({
            name: 'Salón Aurora', about: expect.stringContaining('Chapinero'), audience: ['B2C'], address: 'Cra 13 #63-21', city: 'Bogotá', country: 'CO',
            phone: '+5716011234', email: 'hola@aurora.co',
        });
        expect(rows.tenant.name).toBe('Salón Aurora');
        const company = rows.companies.find(c => c.is_primary)!;
        expect(company).toMatchObject({ address: 'Cra 13 #63-21', city: 'Bogotá', phone: '+5716011234', email: 'hola@aurora.co' });
        expect(rows.tenant.settings.customerTypes).toEqual(['b2c']);
        // las cuatro proyecciones siguen intactas aunque comparten la fila de companies
        for (const id of ['CORE.IDENTITY.NAME', 'CORE.IDENTITY.DESCRIPTION', 'CORE.LOCATIONS.LIST', 'CORE.CONTACT.CHANNELS']) {
            expect(projectionInSync(sourcesOf(rows), rows.requirement_values!.find(r => r.requirement_id === id)!)).toBe(true);
        }
    });
});

describe('forma del runtime y unión de HOURS_SLA', () => {
    it('hoursToRuntime: 24/7, días cerrados y el ejemplo [[a, b]] de la especificación', () => {
        expect(hoursToRuntime({ always_open: true })?.is247).toBe(true);
        const h = hoursToRuntime({ days: { mon: [['08:00', '12:00'], ['14:00', '18:00']], sat: [['09:00', '13:00']], sun: [] } }, { timezone: 'America/Lima' });
        expect(h?.timezone).toBe('America/Lima');
        expect(h?.schedule.monday.windows).toHaveLength(2);
        expect(h?.schedule.saturday).toEqual({ enabled: true, open: '09:00', close: '13:00' });
        expect(h?.schedule.tuesday.enabled).toBe(false);
        expect(Object.keys(h!.schedule)).toHaveLength(7);
    });

    it('sla_out_of_hours: siguiente_apertura o una duración ISO-8601; sigue aceptando el literal viejo `duration`', () => {
        const write = (sla: unknown) => validateRequirementValue(spec, 'CORE.HANDOFF.HOURS_SLA', { value: { sla_out_of_hours: sla }, status: 'confirmed', origin: 'owner_form' });
        for (const ok of ['siguiente_apertura', 'PT4H', 'P1D', 'PT30M', 'P1DT2H', 'duration']) expect(write(ok)).toEqual([]);
        for (const bad of ['mañana', 'P', 'PT', '4h', 'P1DT']) expect(write(bad).map(i => i.code)).toEqual(['enum']);
        expect(isIsoDuration('PT4H')).toBe(true);
    });
});
