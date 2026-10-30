/**
 * R4 · contrato de conocimiento del turno (C0 §1.2) y diccionario cerrado de WRITE_MODE.required_fields (ADR 0010).
 * Se prueba sobre las fotos golden de los 7 tenants QA y sobre fotos armadas a mano para cada estado.
 */
import * as fs from 'node:fs';
import { buildTurnContract, renderKnowledgeStatus, type TurnKnowledgeContract } from '../src/contract/turn';
import { compose } from '../src/compose';
import { evaluate } from '../src/engine/evaluate';
import { resolveFacts } from '../src/facts';
import { formFor } from '../src/forms/descriptor';
import { COMMON_NEVER } from '../src/qa/truth';
import { requiredFieldsOutsideDictionary, validateRequirementValue } from '../src/validate-value';
import { FIXTURES, NOW, admin, base, fixtureSnapshot, item, region, spec, val } from './helpers';

const SLUGS = fs.readdirSync(FIXTURES).filter(f => f.endsWith('.snapshot.json')).map(f => f.replace('.snapshot.json', '')).sort();
const STATES = ['confirmed', 'example', 'seeded', 'absent', 'contradictory', 'stale'];
const CODES = ['PREG', 'NC+AV', 'HUM', 'EXT', 'GAP'];
/** Lo que la API pinta en el prompt: sin prohibiciones comunes (van en la regla L1) y sin `writes` en modo sombra. */
const PROMPT = { indent: '  ', includeCommonNever: false, includeWrites: false } as const;

const contractOf = (snap: ReturnType<typeof base>, intents?: string[]): TurnKnowledgeContract =>
    buildTurnContract(spec, snap, evaluate(spec, snap, NOW), { now: NOW, ...(intents ? { intents } : {}) });

describe('turnContract sobre los 7 tenants QA', () => {
    it('hay 7 fotos golden', () => expect(SLUGS).toHaveLength(7));

    it.each(SLUGS)('%s: todo requisito aplicable que el agente ve está una sola vez, como dato o como «no consta»', slug => {
        const snap = fixtureSnapshot(slug);
        const result = evaluate(spec, snap, NOW);
        const c = buildTurnContract(spec, snap, result, { now: NOW });
        expect(c).toMatchObject({ schema: 'business-spec/turn-contract@1', specVersion: spec.specVersion, verdict: result.verdict, resultHash: result.resultHash });

        const ids = [...c.facts.map(f => f.id), ...c.unknown.map(u => u.id)];
        expect(new Set(ids).size).toBe(ids.length);
        const visible = compose(spec, resolveFacts(spec, snap, NOW))
            .filter(e => e.applies && ['always_in_context', 'read_on_intent'].includes(e.req.exposure)).map(e => e.req.id);
        for (const r of result.requirements.filter(x => visible.includes(x.id))) {
            const ok = r.result === 'cumple' && Object.values(r.levelResults ?? {}).every(x => x === 'cumple');
            if (ok) {
                // un dato afirmable no está en «no consta»; los read_on_intent solo entran con su intención
                expect(c.unknown.find(u => u.id === r.id)).toBeUndefined();
                if (spec.requirements[r.id].exposure === 'always_in_context') expect(c.facts.map(f => f.id)).toContain(r.id);
            } else if (!(r.gap?.rootCause && visible.includes(r.gap.rootCause))) {
                // «unknown» no depende de la intención: todo lo no afirmable está, con el código de la especificación
                const u = c.unknown.find(x => x.id === r.id);
                expect(u).toBeDefined();
                expect(u?.code).toBe(spec.requirements[r.id].whenMissing.code);
            }
        }
        for (const u of c.unknown) {
            expect(STATES).toContain(u.state);
            expect(u.state).not.toBe('confirmed');
            expect(CODES).toContain(u.code);
            expect(u).not.toHaveProperty('value');
        }
        for (const f of c.facts) expect(f.state).toBe('confirmed');
        // ningún requisito de plataforma o de cuenta se cuela en el turno
        for (const id of ids) expect(['always_in_context', 'read_on_intent']).toContain(spec.requirements[id].exposure);
        expect(c.never).toEqual(COMMON_NEVER);
        expect(Object.keys(c.offers.writes).sort()).toEqual(result.config.objects.map(o => o.object).sort());
    });

    it.each(SLUGS)('%s: sin WRITE_MODE declarado el objeto se ofrece como «none» (C0 when_missing)', slug => {
        const c = contractOf(fixtureSnapshot(slug));
        for (const w of Object.values(c.offers.writes)) expect(w).toEqual({ mode: 'none', declared: false });
    });

    it.each(SLUGS)('%s: el bloque <knowledge_status> del prompt cabe en el presupuesto (≤ 600 tokens p95, ~3,5 caracteres por token)', slug => {
        const text = renderKnowledgeStatus(contractOf(fixtureSnapshot(slug)), PROMPT);
        expect(text.length).toBeLessThanOrEqual(2200);
        expect(text).not.toContain('writes=');
    });

    it('bloque del prompt de la clínica dental QA (instantánea)', () => {
        expect(renderKnowledgeStatus(contractOf(fixtureSnapshot('spark-qa-dental-03')), PROMPT)).toMatchSnapshot();
    });
});

describe('turnContract: estado de cada dato', () => {
    const filled = () => {
        const s = admin(region(base('salud/dental')));
        val(s, 'CORE.IDENTITY.NAME', { display_name: 'Clínica Sonrisa' });
        val(s, 'CORE.PAYMENT.METHODS', { methods: ['efectivo', 'transferencia'] });
        return s;
    };

    it('confirmado y always_in_context → fact con su valor', () => {
        const c = contractOf(filled());
        expect(c.facts.find(f => f.id === 'CORE.PAYMENT.METHODS')).toEqual({
            id: 'CORE.PAYMENT.METHODS', topic: spec.requirements['CORE.PAYMENT.METHODS'].title, state: 'confirmed', source: 'value',
            value: { methods: ['efectivo', 'transferencia'] },
        });
        expect(c.unknown.find(u => u.id === 'CORE.PAYMENT.METHODS')).toBeUndefined();
    });

    it('ausente, sembrado, ejemplo, contradictorio y caducado → unknown con su estado y su when_missing, sin valor', () => {
        const s = filled();
        s.values['CORE.HOURS.REGULAR'] = [{ value: { mon: [['08:00', '17:00']] }, status: 'seeded', origin: 'platform_seed' }];
        s.values['CORE.POLICY.CANCELLATION_CHANGES'] = [{ value: { summary: 'ej.' }, status: 'example', origin: 'platform_seed' }];
        s.values['CORE.CONTACT.CHANNELS'] = [
            { value: { phone: '1' }, status: 'confirmed', origin: 'owner_form', confirmedAt: '2026-10-01T00:00:00Z' },
            { value: { phone: '2' }, status: 'confirmed', origin: 'owner_form', confirmedAt: '2026-10-02T00:00:00Z' },
        ];
        s.values['CORE.LANGUAGES.SERVED'] = [{ value: { agent: ['es'] }, status: 'confirmed', origin: 'owner_form', validUntil: '2026-01-01T00:00:00Z' }];
        const c = contractOf(s);
        const state = (id: string) => c.unknown.find(u => u.id === id)?.state;
        expect(state('CORE.LOCATIONS.LIST')).toBe('absent');
        expect(state('CORE.HOURS.REGULAR')).toBe('seeded');
        expect(state('CORE.POLICY.CANCELLATION_CHANGES')).toBe('example');
        expect(state('CORE.CONTACT.CHANNELS')).toBe('contradictory');
        expect(state('CORE.LANGUAGES.SERVED')).toBe('stale');
        expect(c.unknown.find(u => u.id === 'CORE.HOURS.REGULAR')).toMatchObject({ code: 'NC+AV', never: spec.requirements['CORE.HOURS.REGULAR'].whenMissing.never });
        const text = renderKnowledgeStatus(c, PROMPT);
        expect(text).toContain('CORE.HOURS.REGULAR[seeded]');
        expect(text).toContain('CORE.CONTACT.CHANNELS[contradictory]');
        expect(text).not.toContain('08:00');
    });

    it('un ítem de ejemplo se puede nombrar pero su precio no: el catálogo queda en unknown', () => {
        const s = filled();
        item(s, 'appointment', { name: 'Limpieza', duration: 30, price_type: 'fijo', price: 90000 }, { contentStatus: 'example', priceStatus: 'example', priceType: 'fijo' });
        const c = contractOf(s);
        expect(c.unknown.map(u => u.id)).toEqual(expect.arrayContaining(['OBJ.APPOINTMENT.CATALOG']));
        expect(renderKnowledgeStatus(c, PROMPT)).not.toContain('90000');
    });

    it('read_on_intent solo entra en facts con su intención; unknown no depende de ella', () => {
        const s = filled();
        val(s, 'CORE.OFFER.NOT_OFFERED', { items: [{ item: 'ortodoncia invisible' }] });
        const without = contractOf(s);
        const notOffered = spec.requirements['CORE.OFFER.NOT_OFFERED'];
        expect(notOffered.exposure).toBe('read_on_intent');
        expect(without.facts.find(f => f.id === 'CORE.OFFER.NOT_OFFERED')).toBeUndefined();
        const withIntent = contractOf(s, [notOffered.answers[0]]);
        expect(withIntent.facts.find(f => f.id === 'CORE.OFFER.NOT_OFFERED')?.value).toEqual({ items: [{ item: 'ortodoncia invisible' }] });
        expect(withIntent.unknown.map(u => u.id).sort()).toEqual(without.unknown.map(u => u.id).sort());
    });

    it('offers: «lo averiguo» solo con CORE.PENDING.ROUTING; writes con el modo declarado', () => {
        const s = filled();
        val(s, 'OBJ.APPOINTMENT.WRITE_MODE', { mode: 'request_to_business', required_fields: ['nombre', 'telefono'], confirmation_terms: ['fecha_hora'], business_confirm_sla: { min: 2, unit: 'h' }, request_message: { es: 'Quedó tu solicitud' } });
        const c = contractOf(s);
        expect(c.offers.pendingQuestion).toBe(false);
        expect(c.offers.writes.appointment).toEqual({ mode: 'request_to_business', declared: true });
        expect(renderKnowledgeStatus(c, { includeWrites: true })).toContain('writes="appointment=request_to_business"');
    });
});

describe('WRITE_MODE.required_fields: diccionario cerrado por objeto (R4)', () => {
    it('cada objeto tiene su diccionario, que incluye los campos comunes', () => {
        for (const o of Object.values(spec.objects)) {
            expect(o.customerFields).toEqual(expect.arrayContaining(['nombre', 'telefono', 'fecha_hora']));
            expect(new Set(o.customerFields).size).toBe(o.customerFields.length);
        }
        expect(spec.objects.lodging_booking.customerFields).toEqual(expect.arrayContaining(['fecha_entrada', 'fecha_salida', 'huespedes']));
    });

    const write = (value: unknown, previous?: unknown) => validateRequirementValue(spec, 'OBJ.APPOINTMENT.WRITE_MODE', {
        value, status: 'confirmed', origin: 'owner_form', ...(previous !== undefined ? { previous } : {}),
    });
    const ok = { mode: 'direct_commit', required_fields: ['nombre', 'telefono', 'profesional'], confirmation_terms: ['fecha_hora'] };

    it('acepta campos del diccionario y rechaza los de fuera', () => {
        expect(write(ok)).toEqual([]);
        const issues = write({ ...ok, required_fields: ['nombre', 'grupo_sanguineo'] });
        expect(issues).toEqual([expect.objectContaining({ path: 'required_fields', code: 'enum' })]);
        expect(issues[0].message).toContain('grupo_sanguineo');
        // `huespedes` es de alojamiento, no de citas
        expect(requiredFieldsOutsideDictionary(spec, 'OBJ.APPOINTMENT.WRITE_MODE', { required_fields: ['huespedes'] })).toEqual(['huespedes']);
    });

    it('un campo libre ya guardado (lista abierta hasta R3) sigue siendo válido; uno nuevo no', () => {
        const previous = { ...ok, required_fields: ['nombre', 'grupo_sanguineo'] };
        expect(write({ ...ok, required_fields: ['nombre', 'grupo_sanguineo'] }, previous)).toEqual([]);
        expect(write({ ...ok, required_fields: ['nombre', 'grupo_sanguineo', 'alergias_raras'] }, previous)[0].message).toContain('alergias_raras');
    });

    it('el formulario ofrece la lista cerrada del objeto', () => {
        const f = formFor(spec.requirements['OBJ.LODGING_BOOKING.WRITE_MODE'], spec).fields.find(x => x.key === 'required_fields');
        expect(f).toMatchObject({ kind: 'enum_list', open: false });
        expect(f?.options?.map(o => o.value)).toEqual(spec.objects.lodging_booking.customerFields);
    });

    it('el motor no deja de cumplir por un campo libre guardado antes', () => {
        const s = admin(region(base('salud/dental')));
        val(s, 'OBJ.APPOINTMENT.WRITE_MODE', { mode: 'request_to_business', required_fields: ['nombre', 'campo_libre'], confirmation_terms: ['fecha_hora'], business_confirm_sla: { min: 2, unit: 'h' }, consent_required: true, request_message: { es: 'Quedó tu solicitud' } });
        const before = evaluate(spec, s, NOW).requirements.find(r => r.id === 'OBJ.APPOINTMENT.WRITE_MODE');
        expect(before).toMatchObject({ result: 'cumple' });
    });
});
