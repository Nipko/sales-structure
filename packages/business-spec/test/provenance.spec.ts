/**
 * R3 (C0 §2.1, §2.2, §2.9): procedencia real, migración L1–L7 y su prueba de equivalencia.
 *
 * Aceptación R3 #3: el veredicto del motor con reglas L (antes de la migración) y con la procedencia que deja la
 * migración (después) es idéntico en los 7 tenants QA. Se exige más: el mismo `resultHash` (mismos resultados,
 * huecos y avisos) y la misma verdad QA.
 * Aceptación R3 #4 (prueba de propiedad): un precio `example` nunca cuenta como confirmado y un `[]` por defecto de
 * columna nunca es «vacío confirmado».
 */
import { applyBackfillPlan, planProvenanceBackfill } from '../src/backfill';
import { evaluate } from '../src/engine/evaluate';
import { fromLegacyRows, legacyContextOf, rowProvenance, type LegacyTenantRows } from '../src/legacy-status';
import { BACKFILL_MARK, PROVENANCE_TABLES, valueFingerprint } from '../src/provenance';
import { itemFieldState, qaTruth } from '../src/qa/truth';
import { resolveValue } from '../src/status';
import type { ItemRecord, TenantSnapshot } from '../src/types';
import { validateRequirementValue } from '../src/validate-value';
import { NOW, fixtureRows, spec } from './helpers';

const QA = [
    'agencia-qa-viajes', 'inmobiliaria-qa', 'salon-qa-citas', 'spark-qa-comida-04', 'spark-qa-dental-03', 'spark-qa-hotel-09',
    'tienda-qa-electronica',
];

/** Verdad QA de cada requisito y de cada ítem de catálogo (sin el hash de la foto, que cambia porque la foto lleva la procedencia). */
const truthOf = (rows: LegacyTenantRows) => {
    const snap = fromLegacyRows(rows);
    const one = (query: { requirementId: string; itemId?: string }) => {
        try {
            const { snapshotHash: _hash, ...rest } = qaTruth(spec, snap, query, NOW);
            return rest;
        } catch (err) {
            return { query, error: (err as Error).message };
        }
    };
    const items = Object.entries(snap.items).flatMap(([object, list]) => list.map(i => ({ requirementId: `OBJ.${object.toUpperCase()}.CATALOG`, itemId: i.id })));
    return [...spec.order.map(requirementId => one({ requirementId })), ...items.map(one)];
};

const migrate = (rows: LegacyTenantRows) => {
    const plan = planProvenanceBackfill(spec, rows, { now: NOW });
    return { plan, after: applyBackfillPlan(rows, plan) };
};

describe('migración de procedencia: equivalencia en los 7 tenants QA (R3 #3)', () => {
    it.each(QA)('%s: mismo veredicto, mismo resultHash y misma verdad QA antes y después', slug => {
        const before = fixtureRows(slug);
        const { plan, after } = migrate(before);
        const a = evaluate(spec, fromLegacyRows(before), NOW);
        const b = evaluate(spec, fromLegacyRows(after), NOW);
        expect(b.verdict).toBe(a.verdict);
        expect(b.requirements.map(r => [r.id, r.result, r.valueStatus])).toEqual(a.requirements.map(r => [r.id, r.result, r.valueStatus]));
        expect(b.resultHash).toBe(a.resultHash);
        expect(truthOf(after)).toEqual(truthOf(before));
        // la migración hizo algo: cada fila de ítems y textos y cada valor copiable quedaron con procedencia real
        expect(plan.values.length).toBeGreaterThan(0);
        const snapAfter = fromLegacyRows(after);
        const itemRows = Object.values(snapAfter.items).flat().filter(i => i.origin !== 'integration');
        expect(itemRows.every(i => i.legacyRule === null)).toBe(true);
        expect(snapAfter.texts.every(t => t.legacyRule === null)).toBe(true);
    });

    it.each(QA)('%s: idempotente (una segunda pasada no planea nada)', slug => {
        const { after } = migrate(fixtureRows(slug));
        const again = planProvenanceBackfill(spec, after, { now: NOW });
        expect(again.rows).toEqual([]);
        expect(again.values).toEqual([]);
    });

    it('cada valor copiado lleva de dónde salió, su huella y la marca de la migración', () => {
        const { plan } = migrate(fixtureRows('spark-qa-dental-03'));
        for (const v of plan.values) {
            expect(v.sourceRef).toMatchObject({ backfill: BACKFILL_MARK, migrated_hash: valueFingerprint(v.value) });
            expect(v.specVersion).toBe(spec.specVersion);
            expect(validateRequirementValue(spec, v.requirementId, { value: v.value, status: v.status, origin: v.origin, scopeKey: v.scopeKey })).toEqual([]);
        }
        const name = plan.values.find(v => v.requirementId === 'CORE.IDENTITY.NAME');
        expect(name).toMatchObject({ status: 'confirmed', origin: 'onboarding', sourceRef: { migrated_from: 'tenants.name', legacy_rule: 'L2' } });
        const triggers = plan.values.find(v => v.requirementId === 'CORE.HANDOFF.ALWAYS_HUMAN');
        expect(triggers).toMatchObject({ status: 'seeded', origin: 'platform_seed', sourceRef: { legacy_rule: 'L5' } });
    });

    it('no copia L4, la región ni el horario deducido de la agenda; lo deja leído con reglas L', () => {
        const { plan } = migrate(fixtureRows('spark-qa-dental-03'));
        const ids = new Set(plan.values.map(v => v.requirementId));
        expect(ids.has('CORE.IDENTITY.REGION')).toBe(false);
        expect(plan.skipped.some(s => s.storage.startsWith('availability_slots'))).toBe(true); // dental: horario de la agenda sembrada
        expect(plan.values.some(v => v.sourceRef.legacy_rule === 'L4')).toBe(false);
    });
});

describe('lectura de la procedencia real', () => {
    const dental = () => fixtureRows('spark-qa-dental-03');

    it('una fila migrada que después toca un editor viejo vuelve a las reglas L (L6: editada → confirmada)', () => {
        const { after } = migrate(dental());
        const svc = after.services[0];
        expect(fromLegacyRows(after).items.appointment[0]).toMatchObject({ contentStatus: 'seeded', origin: 'platform_seed', legacyRule: null });
        svc.updated_at = '2026-10-29T10:00:00.000Z'; // la pantalla de servicios de hoy no conoce content_status
        expect(fromLegacyRows(after).items.appointment[0]).toMatchObject({ contentStatus: 'confirmed', legacyRule: 'L1' });
    });

    it('el content_status solo (default de columna `confirmed`) no es procedencia: sin origin decide L3', () => {
        const rows = dental();
        rows.services = rows.services.map(s => ({ ...s, content_status: 'confirmed' }));
        expect(fromLegacyRows(rows).items.appointment.every(i => i.contentStatus === 'seeded' && i.legacyRule === 'L3')).toBe(true);
    });

    it('un valor migrado cuyo almacenamiento de hoy cambió después se ignora y manda el almacenamiento (expand)', () => {
        const { after } = migrate(dental());
        const migrated = (after.requirement_values ?? []).find(v => v.requirement_id === 'CORE.IDENTITY.NAME');
        expect(migrated).toBeDefined();
        after.tenant.name = 'Clínica Sonrisa Nueva';
        const snap = fromLegacyRows(after);
        expect(snap.values['CORE.IDENTITY.NAME']).toHaveLength(1);
        expect(snap.values['CORE.IDENTITY.NAME'][0]).toMatchObject({ value: { display_name: 'Clínica Sonrisa Nueva' }, legacyRule: 'L2' });
        expect(snap.source.notes?.some(n => /ignorados/.test(n))).toBe(true);
    });

    it('un valor escrito por BusinessFactsService manda sobre todo lo heredado de ese requisito y alcance', () => {
        const rows = dental();
        rows.tenant.settings = { ...rows.tenant.settings, businessHours: { schedule: { monday: '08:00-12:00' } } };
        rows.requirement_values = [{
            id: 'rv-1', requirement_id: 'CORE.HOURS.REGULAR', scope_key: '', status: 'confirmed', origin: 'owner_form',
            value: { always_open: false, days: { mon: [{ open: '09:00', close: '17:00' }] } }, confirmed_at: NOW.toISOString(),
            source_ref: null, spec_version: spec.specVersion, version: 2,
        }];
        const values = fromLegacyRows(rows).values['CORE.HOURS.REGULAR'];
        expect(values).toHaveLength(1);
        expect(values[0]).toMatchObject({ origin: 'owner_form', storage: 'requirement_values' });
        expect(resolveValue(values, NOW).state).toBe('confirmado');
    });

    it('una contradicción entre dos almacenamientos confirmados sigue a la vista después de migrar', () => {
        const rows = dental();
        rows.tenant.settings = { ...rows.tenant.settings, businessHours: { schedule: { monday: '08:00-12:00' } } };
        rows.agent_personas = rows.agent_personas.map(p => ({
            ...p, template_id: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-21T10:00:00Z',
            config_json: { ...(p.config_json ?? {}), hours: { schedule: { monday: '10:00-14:00' } } },
        }));
        const before = resolveValue(fromLegacyRows(rows).values['CORE.HOURS.REGULAR'], NOW).state;
        expect(before).toBe('contradictorio');
        const { plan, after } = migrate(rows);
        const hours = plan.values.find(v => v.requirementId === 'CORE.HOURS.REGULAR');
        expect(hours?.sourceRef.contradiction_with).toHaveLength(1);
        expect(resolveValue(fromLegacyRows(after).values['CORE.HOURS.REGULAR'], NOW).state).toBe('contradictorio');
    });

    it('price_status = quote: la migración escribe price_type = a_cotizar y deja price_status (lo leen las pantallas de hoy)', () => {
        const rows = dental();
        rows.services = rows.services.map((s, i) => (i === 0 ? { ...s, price_status: 'quote', price: 0, updated_at: '2026-10-25T00:00:00Z' } : s));
        const { plan, after } = migrate(rows);
        const planned = plan.rows.find(r => r.table === 'services' && r.id === String(rows.services[0].id));
        expect(planned).toMatchObject({ priceType: 'a_cotizar', contentStatus: 'confirmed' });
        expect(planned).not.toHaveProperty('priceStatus');
        expect(after.services[0].price_status).toBe('quote');
        expect(fromLegacyRows(after).items.appointment[0]).toMatchObject({ priceType: 'a_cotizar', priceStatus: 'confirmed', legacyRule: null });
    });
});

describe('validación de un valor contra la especificación', () => {
    const ok = (id: string, value: unknown, extra: Partial<{ status: 'confirmed' | 'example' | 'seeded'; origin: string; scopeKey: string }> = {}) =>
        validateRequirementValue(spec, id, { value, status: 'confirmed', origin: 'owner_form', ...extra });

    it('acepta valores con la forma de data.structure', () => {
        expect(ok('CORE.IDENTITY.NAME', { display_name: 'Clínica Sonrisa' })).toEqual([]);
        expect(ok('CORE.PAYMENT.METHODS', { methods: ['efectivo', 'transferencia'] })).toEqual([]);
        expect(ok('CORE.SAFETY.FORBIDDEN_TOPICS', [])).toEqual([]); // [] = vacío confirmado
        expect(ok('OBJ.APPOINTMENT.WRITE_MODE', { mode: 'request_to_business', business_confirm_sla: { min: 2, unit: 'h' } })).toEqual([]);
        expect(ok('CORE.POLICY.CANCELLATION_CHANGES', { summary: 'texto migrado' }, { origin: 'legacy' })).toEqual([]);
    });

    it('rechaza lo que la especificación no admite', () => {
        expect(ok('CORE.NOPE', {})[0].code).toBe('unknown_requirement');
        expect(ok('CORE.IDENTITY.NAME', { display_name: '' }).map(i => i.code)).toContain('required');
        expect(ok('CORE.IDENTITY.NAME', { display_name: 'x', color: 'azul' }).map(i => i.code)).toContain('shape');
        expect(ok('CORE.IDENTITY.NAME', 'Clínica').map(i => i.code)).toContain('shape');
        expect(ok('OBJ.APPOINTMENT.WRITE_MODE', { mode: 'siempre' }).map(i => i.code)).toContain('enum');
        expect(ok('OBJ.APPOINTMENT.WRITE_MODE', { mode: 'none', consent_required: 'sí' }).map(i => i.code)).toContain('type');
        expect(ok('CORE.IDENTITY.NAME', null).map(i => i.code)).toContain('shape');
        expect(ok('CORE.IDENTITY.NAME', { display_name: 'x' }, { origin: 'cualquiera' }).map(i => i.code)).toContain('origin');
        expect(ok('CORE.IDENTITY.NAME', { display_name: 'x' }, { status: 'seeded' }).map(i => i.code)).toContain('status');
        expect(ok('CORE.IDENTITY.NAME', { display_name: 'x' }, { scopeKey: 'cualquier cosa' }).map(i => i.code)).toContain('scope');
        expect(ok('CORE.SAFETY.EMERGENCY_BASE', {})[0].code).toBe('not_writable');
        expect(ok('OBJ.APPOINTMENT.CATALOG', [])[0].code).toBe('not_writable');
    });

    it('aceptar un default (§2.5): solo en requisitos «default aceptado», con valor null', () => {
        expect(ok('CORE.PRIVACY.CUSTOMER_MEMORY', null, { origin: 'default_accepted' })).toEqual([]);
        expect(ok('CORE.IDENTITY.NAME', null, { origin: 'default_accepted' }).map(i => i.code)).toContain('origin');
    });
});

// ─────────────────────────── propiedades (R3 #4) ───────────────────────────

/** PRNG determinista (mulberry32): la prueba recorre siempre los mismos casos. */
function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

describe('propiedad: un precio de ejemplo nunca cuenta como confirmado', () => {
    const tables = Object.entries(PROVENANCE_TABLES).filter(([, c]) => c.kind === 'item').map(([t]) => t);
    const ctx = legacyContextOf(fixtureRows('spark-qa-dental-03'));
    const r = rng(20261030);

    it('en la lectura (reglas L o procedencia real, vigente o vieja), en el motor y en la verdad QA', () => {
        for (let n = 0; n < 500; n++) {
            const table = pick(r, tables);
            const priceCol = PROVENANCE_TABLES[table].price as string;
            const updated = pick(r, ['2026-10-18T09:22:34.100Z', '2026-10-25T08:00:00.000Z']);
            const row: Record<string, unknown> = {
                id: `x${n}`, created_at: '2026-10-18T09:22:34.100Z', updated_at: updated, [priceCol]: pick(r, [0, 1, 50_000, null]),
                price_status: 'example',
                ...(r() < 0.6 ? {
                    content_status: pick(r, ['confirmed', 'example', 'seeded']), origin: pick(r, ['owner_form', 'legacy', 'legacy_inferred', 'platform_seed', 'import']),
                    price_type: pick(r, [null, 'fijo', 'desde', 'a_cotizar', 'gratis']),
                    source_ref: { row_updated_at: pick(r, [updated, '2026-01-01T00:00:00Z']) },
                } : {}),
            };
            const p = rowProvenance(table, row, ctx);
            expect(p.priceStatus).toBe('example');

            const item: ItemRecord = {
                id: String(row.id), active: true, contentStatus: p.contentStatus, origin: p.origin, legacyRule: p.legacyRule,
                priceStatus: p.priceStatus, priceType: p.priceType, fields: { name: 'X', price: row[priceCol] ?? 10 },
            };
            expect(itemFieldState(item, 'price')).not.toBe('confirmado');
            const snap: TenantSnapshot = fromLegacyRows(fixtureRows('spark-qa-dental-03'));
            snap.items.appointment = [item];
            const price = evaluate(spec, snap, NOW).requirements.find(x => x.id === 'CORE.OFFER.PRICE_MODEL');
            expect(price?.result).not.toBe('cumple');
        }
    });

    it('en un valor de negocio: status example nunca resuelve a confirmado', () => {
        for (let n = 0; n < 200; n++) {
            const recs = Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({
                value: { amount: Math.floor(r() * 100) }, status: pick(r, ['example', 'seeded'] as const), origin: pick(r, ['owner_form', 'platform_seed', 'legacy']),
            }));
            expect(resolveValue(recs, NOW).state).not.toBe('confirmado');
        }
    });
});

describe('propiedad: un [] por defecto de columna nunca es vacío confirmado', () => {
    const r = rng(42);
    const LIST_FIELDS: Record<string, Array<[string, string]>> = {
        menu_items: [['allergens', 'allergens'], ['tags', 'diet_tags']],
        tour_packages: [['includes', 'includes'], ['excludes', 'excludes'], ['languages', 'guide_languages']],
        services: [['required_fields', 'required_fields']],
    };

    it.each(['spark-qa-comida-04', 'agencia-qa-viajes', 'spark-qa-dental-03'])('%s: con reglas L y con la procedencia que deja la migración', slug => {
        for (let n = 0; n < 60; n++) {
            const rows = fixtureRows(slug);
            const migrated = r() < 0.5;
            const base = migrated ? migrate(rows).after : rows;
            for (const [table, fields] of Object.entries(LIST_FIELDS)) {
                const list = (base as unknown as Record<string, Array<Record<string, unknown>>>)[table];
                for (const row of list ?? []) for (const [col] of fields) row[col] = r() < 0.5 ? [] : '[]';
                for (const row of list ?? []) if (migrated && r() < 0.5) row.content_status = pick(r, ['confirmed', 'seeded', 'example']);
            }
            const snap = fromLegacyRows(base);
            const items = [...(snap.items.food_order ?? []), ...(snap.items.tour_booking ?? []), ...(snap.items.appointment ?? [])];
            for (const it of items) {
                for (const [field, st] of Object.entries(it.fieldStatus ?? {})) {
                    const v = it.fields[field];
                    if (Array.isArray(v) && v.length === 0 && field !== 'staff_ids') {
                        expect(st).not.toBe('confirmed');
                        expect(itemFieldState(it, field)).not.toBe('confirmado');
                    }
                }
            }
            const allergens = evaluate(spec, snap, NOW).requirements.find(x => x.id === 'OBJ.FOOD_ORDER.ALLERGENS_DIET');
            if (allergens?.applies && snap.items.food_order?.length) expect(allergens.result).not.toBe('cumple');
        }
    });
});
