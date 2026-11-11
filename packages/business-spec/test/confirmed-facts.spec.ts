/**
 * C14 (dental): lo que el dueño confirma en el panel y no está en `RUNTIME_FACT_IDS` (medios de pago, requisitos de la
 * cita, reglas de cambio, idiomas, alcance clínico…) llega al agente como «Datos confirmados por el negocio». Solo un
 * valor confirmado y vigente; uno sembrado o de ejemplo es «no consta» (opción B).
 */
import { RUNTIME_FACT_IDS, type FactSources } from '../src/business-facts';
import {
    CONFIRMED_FACT_EXCLUDED_PATTERNS, confirmedFactIds, isConfirmedFactRequirement, renderConfirmedFacts, renderFactValue,
    resolveConfirmedFacts,
} from '../src/confirmed-facts';
import { NOW, spec } from './helpers';

const AT = '2026-10-20T10:00:00.000Z';
const row = (requirement_id: string, value: unknown, extra: Record<string, unknown> = {}) => ({
    id: `rv-${requirement_id}`, requirement_id, scope_key: '', value, status: 'confirmed', origin: 'owner_form', confirmed_by: 'u1',
    confirmed_at: AT, source_ref: null, valid_until: null, spec_version: spec.specVersion, version: 1, updated_at: AT, ...extra,
});
const sources = (rows: Record<string, unknown>[]): FactSources => ({
    tenant: { ref: 't-dental', slug: 'dental', name: 'Clínica Dental', settings: {}, operating_country: 'CO', operating_timezone: 'America/Bogota' },
    companies: [], policies: [], requirement_values: rows,
});

const PAYMENT = { methods: ['efectivo', 'tarjeta_débito', 'tarjeta_crédito', 'Nequi', 'transferencia'] };

describe('lista de datos confirmados (derivada de la especificación)', () => {
    const ids = confirmedFactIds(spec);

    it('incluye los datos de C14 y los que el dueño confirmó en el tenant dental', () => {
        for (const id of ['CORE.PAYMENT.METHODS', 'CORE.PAYMENT.TIMING_DEPOSIT', 'CORE.PAYMENT.FINANCING', 'CORE.PAYMENT.INVOICING',
            'CORE.LANGUAGES.SERVED', 'CORE.IDENTITY.REGION', 'DOM.HEALTH.CLINICAL_SCOPE', 'DOM.HEALTH.EMERGENCY_PROTOCOL',
            'OBJ.APPOINTMENT.CUSTOMER_REQUIREMENTS', 'OBJ.APPOINTMENT.CHANGE_RULES']) expect(ids).toContain(id);
    });

    it('excluye la configuración de comportamiento, el catálogo y lo que ya llega por RUNTIME_FACT_IDS', () => {
        for (const id of ['CORE.SAFETY.FORBIDDEN_TOPICS', 'CORE.SAFETY.EMERGENCY_BASE', 'CORE.PRIVACY.CUSTOMER_MEMORY', 'CORE.KNOWLEDGE.AGENT_INSTRUCTIONS',
            'CORE.KNOWLEDGE.FAQ_HYGIENE', 'DOM.HEALTH.SENSITIVE_DATA', 'OBJ.APPOINTMENT.WRITE_MODE', 'OBJ.APPOINTMENT.ACCOUNT_READ',
            'OBJ.APPOINTMENT.AVAILABILITY_SOURCE', 'OBJ.APPOINTMENT.CATALOG', 'CORE.HANDOFF.ALWAYS_HUMAN', 'CORE.HANDOFF.HOURS_SLA',
            'CORE.OFFER.ITEMS', 'CORE.OFFER.PRICE_MODEL', 'CORE.IDENTITY.PROFILE']) expect(ids).not.toContain(id);
        for (const id of RUNTIME_FACT_IDS) expect(ids).not.toContain(id);
    });

    it('todo ID de la lista existe, se ve en el turno y no cae en un patrón excluido; los always_in_context van primero', () => {
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
            const req = spec.requirements[id];
            expect(req).toBeDefined();
            expect(['always_in_context', 'read_on_intent']).toContain(req.exposure);
            expect(isConfirmedFactRequirement(req)).toBe(true);
        }
        const firstOnIntent = ids.findIndex(id => spec.requirements[id].exposure === 'read_on_intent');
        expect(ids.slice(firstOnIntent).every(id => spec.requirements[id].exposure === 'read_on_intent')).toBe(true);
        expect(CONFIRMED_FACT_EXCLUDED_PATTERNS.length).toBeGreaterThan(0);
    });
});

describe('resolveConfirmedFacts', () => {
    it('C14: el medio de pago confirmado llega legible con el título de la especificación', () => {
        const facts = resolveConfirmedFacts(spec, sources([row('CORE.PAYMENT.METHODS', PAYMENT)]), NOW);
        expect(facts).toEqual([{ id: 'CORE.PAYMENT.METHODS', title: 'Medios de pago aceptados',
            text: 'efectivo, tarjeta débito, tarjeta crédito, Nequi, transferencia' }]);
        expect(renderConfirmedFacts(facts)).toEqual(['Medios de pago aceptados: efectivo, tarjeta débito, tarjeta crédito, Nequi, transferencia']);
    });

    it('un valor sembrado, de ejemplo o vencido no es un dato (opción B)', () => {
        const facts = resolveConfirmedFacts(spec, sources([
            row('CORE.PAYMENT.METHODS', PAYMENT, { status: 'seeded', origin: 'platform_seed' }),
            row('CORE.LANGUAGES.SERVED', { human_languages: ['es'] }, { status: 'example' }),
            row('CORE.PAYMENT.FINANCING', { installments: true }, { valid_until: '2026-01-01T00:00:00.000Z' }),
        ]), NOW);
        expect(facts).toEqual([]);
    });

    it('ignora lo que ya llega por su vía y la configuración de comportamiento aunque esté confirmada', () => {
        const facts = resolveConfirmedFacts(spec, sources([
            row('CORE.HOURS.REGULAR', { days: { mon: [['08:00', '17:00']] } }),
            row('CORE.KNOWLEDGE.AGENT_INSTRUCTIONS', { text: 'sé breve' }),
            row('CORE.SAFETY.FORBIDDEN_TOPICS', { topics: ['política'] }),
            row('OBJ.APPOINTMENT.WRITE_MODE', { mode: 'direct_commit' }),
        ]), NOW);
        expect(facts).toEqual([]);
    });

    it('requisitos de la cita: los tres datos, sin omitir el documento', () => {
        const value = [{ trámite: 'primera_cita', documents: ['nombre completo', 'teléfono', 'número de documento'], conditions: [] }];
        const [fact] = resolveConfirmedFacts(spec, sources([row('OBJ.APPOINTMENT.CUSTOMER_REQUIREMENTS', value)]), NOW);
        expect(fact.title).toBe('Requisitos y documentos del cliente para el trámite');
        expect(fact.text).toBe('trámite: primera cita, documentos: nombre completo, teléfono, número de documento');
    });
});

describe('renderFactValue y el tope del bloque', () => {
    it('pinta i18n, booleanos, montos, duraciones y objetos', () => {
        expect(renderFactValue({ es: 'Hola', en: 'Hi' })).toBe('Hola');
        expect(renderFactValue({ when: 'anticipo_parcial', deposit: { amount: 50000, currency: 'COP' }, refundable: false }))
            .toBe('cuándo: anticipo parcial; anticipo: 50000 COP; reembolsable: no');
        expect(renderFactValue({ agent_languages: ['es', 'en'], human_languages: ['es'], translate_content: true }))
            .toBe('idiomas del agente: es, en; idiomas del equipo: es; traduce el contenido: sí');
        expect(renderFactValue({ sla: { min: 1, unit: 'día' } })).toBe('1 día');
        expect(renderFactValue('texto con espacios_y guiones')).toBe('texto con espacios_y guiones');
    });

    it('recorta un dato largo y omite enteros los que no caben en el total', () => {
        const [fact] = resolveConfirmedFacts(spec, sources([row('CORE.PAYMENT.METHODS', { methods: Array.from({ length: 200 }, (_, i) => `medio_${i}`) })]), NOW);
        expect(fact.text.length).toBeLessThanOrEqual(360);
        expect(fact.text.endsWith('…')).toBe(true);
        const lines = renderConfirmedFacts([fact, { ...fact, id: 'X' }, { ...fact, id: 'Y' }], { maxChars: 500 });
        expect(lines).toHaveLength(2);
        expect(lines[1]).toBe('(2 dato(s) más no caben aquí)');
    });
});
