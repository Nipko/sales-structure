/**
 * C6 (rebanada R3, interfaz): descriptores de formulario generados desde `data.structure`.
 *
 * Comprueba que el formulario de cada requisito pide lo que la API valida (requeridos, booleanos y enums cerrados de
 * `validateRequirementValue`), que un valor armado solo con el descriptor se guarda sin rechazo, y que los 13
 * bloqueantes del núcleo y `WRITE_MODE` / `CHANGE_RULES` de los 15 objetos tienen el formulario que leen sus
 * evaluadores.
 */
import { evaluate } from '../src/engine/evaluate';
import { RESERVABLE_OBJECTS } from '../src/facts';
import { formFor, formRequirementIds, parseField, splitTop, type FormDescriptor, type FormField } from '../src/forms/descriptor';
import { isValueRequirement, validateRequirementValue } from '../src/validate-value';
import { NOW, base, region, spec, val } from './helpers';

const CORE_BLOCKERS = [
    'CORE.IDENTITY.NAME', 'CORE.IDENTITY.DESCRIPTION', 'CORE.IDENTITY.PROFILE', 'CORE.IDENTITY.REGION', 'CORE.LOCATIONS.LIST',
    'CORE.HOURS.REGULAR', 'CORE.OFFER.ITEMS', 'CORE.OFFER.PRICE_MODEL', 'CORE.PAYMENT.METHODS', 'CORE.POLICY.CANCELLATION_CHANGES',
    'CORE.PRIVACY.NOTICE', 'CORE.HANDOFF.TEAM', 'CORE.HANDOFF.HOURS_SLA',
];
const OBJECTS = Object.keys(spec.objects);
const objectForms = OBJECTS.flatMap(o => [`OBJ.${o.toUpperCase()}.WRITE_MODE`, `OBJ.${o.toUpperCase()}.CHANGE_RULES`]).filter(id => spec.requirements[id]);

const SAMPLE_TEXT: Record<string, string> = {
    operating_country: 'CO', timezone: 'America/Bogota', currency: 'COP', default_locale: 'es-CO', country: 'CO',
};

/** Un valor armado solo con el descriptor, como lo haría una persona que llena cada campo visible. */
function fill(fields: FormField[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
        const v = sample(f);
        if (v !== undefined) out[f.key] = v;
    }
    return out;
}
function sample(f: FormField): unknown {
    switch (f.kind) {
        case 'readonly': case 'json': return undefined;
        case 'fixed': return f.fixed;
        case 'bool': return false;
        case 'number': return 1;
        case 'enum': return f.options?.[0]?.value ?? 'x';
        case 'enum_list': return f.options?.length ? [f.options[0].value] : ['x'];
        case 'string_list': return ['equipo@negocio.co'];
        case 'duration': return { min: 24, unit: 'h' };
        case 'money': return { amount: 1000, currency: 'COP' };
        case 'day_spans': return Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, [{ open: '08:00', close: '18:00' }]]));
        case 'url': return 'https://negocio.co';
        case 'email': return 'hola@negocio.co';
        case 'address': case 'object': return fill(f.fields ?? []);
        case 'list': return [fill(f.fields ?? [])];
        case 'ref_or_own': return `ref ${f.ref}`;
        default: return SAMPLE_TEXT[f.key] ?? 'Texto de prueba del negocio, sin precios ni horarios, con más de cuarenta caracteres.';
    }
}
const filled = (d: FormDescriptor): unknown => (d.root === 'list' ? [fill(d.fields)] : d.root === 'json' ? {} : fill(d.fields));
const write = (id: string, value: unknown) => validateRequirementValue(spec, id, { value, status: 'confirmed', origin: 'owner_form' });
const walk = (fields: FormField[], cb: (f: FormField) => void) => fields.forEach(f => { cb(f); if (f.fields) walk(f.fields, cb); });

describe('formFor: lectura de la descripción', () => {
    it('parte por comas de primer nivel', () => {
        expect(splitTop('a, b: enum [x, y], c?: {p, q}')).toEqual(['a', 'b: enum [x, y]', 'c?: {p, q}']);
    });

    it.each([
        ['requerido', 'text', true],
        ['bool (24/7)', 'bool', false],
        ['enum [a, b]', 'enum', false],
        ['enum_list [a, b, …]', 'enum_list', false],
        ['duration?', 'duration', false],
        ['money', 'money', false],
        ['text_i18n', 'textarea', false],
        ['weekly_hours (por defecto = CORE.HOURS.REGULAR)', 'object', false],
        ['lista de {name, price: money}', 'list', false],
        ['lista de usuarios', 'string_list', false],
        ['siempre true (P6)', 'fixed', false],
        ['ref CORE.POLICY.CANCELLATION_CHANGES', 'readonly', false],
        ['fijo|desde|a_cotizar|gratis', 'enum', false],
        ['prosa que nadie entiende', 'text', false],
    ])('«%s» → %s', (desc, kind, required) => {
        const f = parseField('campo', desc);
        expect(f.kind).toBe(kind);
        expect(f.required).toBe(required);
    });

    it('un enum_list terminado en «…» es abierto y sin el «…» entre las opciones', () => {
        const f = parseField('methods', 'enum_list [efectivo, tarjeta, …] (catálogo por país)');
        expect(f.open).toBe(true);
        expect(f.options?.map(o => o.value)).toEqual(['efectivo', 'tarjeta']);
    });
});

describe('formFor sobre toda la especificación', () => {
    it('arma un descriptor para cada requisito sin lanzar', () => {
        for (const id of spec.order) {
            const d = formFor(spec.requirements[id], spec);
            expect(d.schema).toBe('business-spec/form@1');
            expect(d.requirementId).toBe(id);
        }
    });

    it('solo los valores del negocio se completan en el cajón; catálogos en su pantalla; derivados y plataforma, en ninguno', () => {
        for (const id of spec.order) {
            const req = spec.requirements[id];
            const d = formFor(req, spec);
            if (d.mode === 'form') expect(isValueRequirement(req)).toBe(true);
            if (!isValueRequirement(req)) expect(d.mode).not.toBe('form');
            if (d.mode === 'screen') expect(d.screens.length).toBeGreaterThan(0);
        }
        expect(formRequirementIds(spec).length).toBeGreaterThan(100);
    });

    it('un valor armado solo con el descriptor no lo rechaza la API (requeridos, booleanos y enums cerrados)', () => {
        const rejected = formRequirementIds(spec)
            .map(id => ({ id, issues: write(id, filled(formFor(spec.requirements[id], spec))) }))
            .filter(r => r.issues.length);
        expect(rejected).toEqual([]);
    });

    it('todo campo que la API exige o restringe a un enum cerrado está en el formulario con la misma regla', () => {
        for (const id of formRequirementIds(spec)) {
            const d = formFor(spec.requirements[id], spec);
            if (d.root !== 'object') continue;
            const structure = spec.requirements[id].data.structure as Record<string, unknown>;
            for (const [rawKey, desc] of Object.entries(structure)) {
                const key = rawKey.replace(/\?$/, '');
                const f = d.fields.find(x => x.key === key);
                const text = String(desc ?? '');
                if (/^requerido\b/.test(text)) expect({ id, key, required: f?.required }).toEqual({ id, key, required: true });
                const en = text.match(/^enum \[([^\]]*)\]/);
                if (en && !/…/.test(en[1]) && f?.kind === 'enum') {
                    const value = { ...(filled(d) as object), [key]: 'fuera_de_la_lista' };
                    expect(write(id, value).some(i => i.code === 'enum')).toBe(true);
                }
            }
        }
    });
});

describe('formularios de R3: 13 bloqueantes del núcleo y WRITE_MODE / CHANGE_RULES de los 15 objetos', () => {
    it('cubren los 15 objetos', () => {
        expect(OBJECTS).toHaveLength(15);
        expect(objectForms.filter(id => id.endsWith('.WRITE_MODE'))).toHaveLength(15);
    });

    it.each(CORE_BLOCKERS)('%s es bloqueante del núcleo y tiene formulario o pantalla', id => {
        const req = spec.requirements[id];
        expect(req.layer).toBe('core');
        expect(req.level).toBe('bloqueante');
        const d = formFor(req, spec);
        if (id === 'CORE.OFFER.ITEMS' || id === 'CORE.OFFER.PRICE_MODEL') {
            expect(d.mode).toBe('screen');
            expect(d.screens.map(s => s.object)).toEqual(expect.arrayContaining(['appointment', 'food_order', 'catalog_order']));
        } else {
            expect(d.mode).toBe('form');
            expect(d.root).toBe('object');
        }
    });

    it.each(objectForms)('%s tiene el formulario que lee su evaluador', id => {
        const d = formFor(spec.requirements[id], spec);
        expect(d.mode).toBe('form');
        const keys = d.fields.map(f => f.key);
        if (id.endsWith('.WRITE_MODE')) {
            expect(keys).toEqual(expect.arrayContaining(['mode', 'required_fields', 'confirmation_terms', 'business_confirm_sla', 'consent_required']));
            expect(d.fields.find(f => f.key === 'business_confirm_sla')?.when).toEqual({ field: 'mode', in: ['request_to_business'] });
        } else {
            const terms = d.fields.find(f => f.key === 'terms');
            expect(keys).toEqual(expect.arrayContaining(['agent_can_modify', 'agent_can_cancel', 'terms']));
            const object = spec.requirements[id].object as string;
            expect(terms?.kind).toBe(RESERVABLE_OBJECTS.has(object) ? 'ref_or_own' : 'object');
            expect(terms?.fields?.find(f => f.key === 'charge')?.required).toBe(true);
        }
    });

    it('cada campo del ejemplo de la especificación está en el formulario', () => {
        for (const id of [...CORE_BLOCKERS, ...objectForms]) {
            const d = formFor(spec.requirements[id], spec);
            const example = spec.requirements[id].data.example;
            if (d.mode !== 'form' || !example || typeof example !== 'object' || Array.isArray(example)) continue;
            const keys = new Set(d.fields.map(f => f.key));
            expect({ id, missing: Object.keys(example).filter(k => !keys.has(k)) }).toEqual({ id, missing: [] });
        }
    });

    it('el horario se pinta por día con tramos {open, close}, la forma que lee el evaluador', () => {
        const d = formFor(spec.requirements['CORE.HOURS.REGULAR'], spec);
        expect(d.fields.find(f => f.key === 'days')?.kind).toBe('day_spans');
        let kinds = 0;
        walk(formFor(spec.requirements['CORE.HANDOFF.HOURS_SLA'], spec).fields, f => { if (f.kind === 'day_spans') kinds++; });
        expect(kinds).toBe(1);
    });

    it('guardar lo que pide el formulario saca del hueco a los bloqueantes del núcleo (sin catálogo)', () => {
        const s = region(base('salud/dental'));
        s.accounts = [];
        const form = (id: string) => filled(formFor(spec.requirements[id], spec)) as Record<string, unknown>;
        val(s, 'CORE.IDENTITY.NAME', { ...form('CORE.IDENTITY.NAME'), display_name: 'Clínica Dental Sonrisa' });
        val(s, 'CORE.IDENTITY.DESCRIPTION', { ...form('CORE.IDENTITY.DESCRIPTION'), short: 'Consultorio odontológico en Chapinero: limpiezas, ortodoncia e implantes.' });
        val(s, 'CORE.LOCATIONS.LIST', form('CORE.LOCATIONS.LIST'));
        val(s, 'CORE.HOURS.REGULAR', form('CORE.HOURS.REGULAR'));
        val(s, 'CORE.PAYMENT.METHODS', form('CORE.PAYMENT.METHODS'));
        val(s, 'CORE.POLICY.CANCELLATION_CHANGES', form('CORE.POLICY.CANCELLATION_CHANGES'));
        val(s, 'CORE.PRIVACY.NOTICE', form('CORE.PRIVACY.NOTICE'));
        val(s, 'CORE.HANDOFF.TEAM', form('CORE.HANDOFF.TEAM'));
        val(s, 'CORE.HANDOFF.HOURS_SLA', form('CORE.HANDOFF.HOURS_SLA'));
        const r = evaluate(spec, s, NOW);
        const failing = CORE_BLOCKERS.filter(id => !['CORE.OFFER.ITEMS', 'CORE.OFFER.PRICE_MODEL', 'CORE.IDENTITY.PROFILE'].includes(id))
            .filter(id => r.requirements.find(x => x.id === id)?.result !== 'cumple');
        expect(failing).toEqual([]);
    });
});
