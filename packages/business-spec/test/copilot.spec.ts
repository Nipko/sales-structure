/**
 * R6 (C0 §1.3, ADR 0012): los guardarraíles deterministas del copiloto de onboarding. El LLM propone; esto decide si la
 * propuesta se guarda. Una cita que no está tal cual en la fuente, o una cifra sin cita, descarta la propuesta entera.
 */
import {
    checkCopilotProposal, figuresWithoutQuote, genericTextReason, isCopilotRequirement, normalizeQuoteText, quoteAppearsIn,
    sameCopilotValue, type CopilotSource,
} from '../src/copilot';
import { evaluate } from '../src/engine/evaluate';
import { NOW, base, spec } from './helpers';

const WEB: CopilotSource = {
    ref: 'S1', kind: 'web', label: 'Inicio', url: 'https://sonrisa.co', origin: 'knowledge_documents:d1',
    text: `Clínica Dental Sonrisa — Chapinero.
Aceptamos   efectivo, tarjeta débito y transferencia “sin recargo”.
Atendemos de lunes a viernes de 8:00 a 18:00 y los sábados de 9 a 13.
Consulta de valoración: $50.000.`,
};
const SOURCES = new Map([[WEB.ref, WEB]]);
const PAYMENT = 'CORE.PAYMENT.METHODS';

describe('copiloto: cita literal', () => {
    it('normaliza espacios, mayúsculas y comillas tipográficas, nunca por parecido', () => {
        expect(normalizeQuoteText('  Aceptamos\n  EFECTIVO “sin recargo” ')).toBe('aceptamos efectivo "sin recargo"');
        expect(quoteAppearsIn(WEB.text, 'aceptamos efectivo, tarjeta débito y transferencia "sin recargo"')).toBe(true);
        expect(quoteAppearsIn(WEB.text, 'Aceptamos efectivo y tarjeta de crédito')).toBe(false);
    });

    it('acepta una propuesta válida con su cita verificada y la fuente resuelta', () => {
        const check = checkCopilotProposal(spec, {
            requirementId: PAYMENT, value: { methods: ['efectivo', 'tarjeta_débito', 'transferencia'] },
            evidence: [{ source_ref: 'S1', quote: 'Aceptamos efectivo, tarjeta débito y transferencia' }],
        }, SOURCES);
        expect(check.rejections).toEqual([]);
        expect(check.ok).toBe(true);
        expect(check.evidence).toEqual([expect.objectContaining({ source_ref: 'S1', origin: 'knowledge_documents:d1', url: 'https://sonrisa.co' })]);
    });

    it('descarta la propuesta si una cita no aparece tal cual (aunque otra sí)', () => {
        const check = checkCopilotProposal(spec, {
            requirementId: PAYMENT, value: { methods: ['efectivo', 'tarjeta_crédito'] },
            evidence: [
                { source_ref: 'S1', quote: 'Aceptamos efectivo, tarjeta débito y transferencia' },
                { source_ref: 'S1', quote: 'Aceptamos tarjeta de crédito' },
            ],
        }, SOURCES);
        expect(check.ok).toBe(false);
        expect(check.rejections.map(r => r.code)).toEqual(['quote_not_verbatim']);
        expect(check.evidence).toEqual([]);
    });

    it('descarta una cita de otra fuente, sin cita, o demasiado corta', () => {
        const value = { methods: ['efectivo'] };
        expect(checkCopilotProposal(spec, { requirementId: PAYMENT, value, evidence: [{ source_ref: 'S9', quote: 'Aceptamos efectivo' }] }, SOURCES)
            .rejections[0].code).toBe('unknown_source');
        expect(checkCopilotProposal(spec, { requirementId: PAYMENT, value, evidence: [] }, SOURCES).rejections[0].code).toBe('no_evidence');
        expect(checkCopilotProposal(spec, { requirementId: PAYMENT, value, evidence: [{ source_ref: 'S1', quote: 'Sonrisa' }] }, SOURCES)
            .rejections[0].code).toBe('quote_too_short');
    });
});

describe('copiloto: cifras', () => {
    it('una cifra del valor que no está en ninguna cita descarta la propuesta (precio u horario inventado)', () => {
        expect(figuresWithoutQuote({ price: 50000 }, ['Consulta de valoración: $50.000.'])).toEqual([]);
        expect(figuresWithoutQuote({ price: 60000 }, ['Consulta de valoración: $50.000.'])).toEqual(['60000']);
        // 18:00 = «6 pm», 09:00 = «9»: la misma hora escrita de otra forma
        expect(figuresWithoutQuote({ from: '09:00', to: '18:00' }, ['de 9 a 6 pm'])).toEqual([]);
        expect(figuresWithoutQuote({ from: '09:00', to: '19:00' }, ['de 9 a 6 pm'])).toEqual(['19:00']);
        // un código de una lista cerrada no es una cifra; una duración ISO sí
        expect(figuresWithoutQuote({ audience: ['B2C', 'B2B'] }, ['Atendemos personas y empresas'])).toEqual([]);
        expect(figuresWithoutQuote({ sla: 'PT4H' }, ['Respondemos en menos de 2 horas'])).toEqual(['4h']);
        expect(figuresWithoutQuote({ sla: 'PT4H' }, ['Respondemos en menos de 4 horas'])).toEqual([]);
    });

    it('vale para el chequeo completo: notas con una cifra sin cita', () => {
        const check = checkCopilotProposal(spec, {
            requirementId: PAYMENT, value: { methods: ['efectivo'], notes: 'Recargo del 5% con tarjeta' },
            evidence: [{ source_ref: 'S1', quote: 'Aceptamos efectivo, tarjeta débito' }],
        }, SOURCES);
        expect(check.rejections.map(r => r.code)).toEqual(['figure_without_quote']);
    });
});

describe('copiloto: estructura y fuentes del requisito', () => {
    it('valida contra data.structure con la misma función que la escritura', () => {
        const check = checkCopilotProposal(spec, {
            requirementId: PAYMENT, value: { metodos: ['efectivo'] },
            evidence: [{ source_ref: 'S1', quote: 'Aceptamos efectivo, tarjeta débito' }],
        }, SOURCES);
        expect(check.rejections.map(r => r.code)).toEqual(['invalid_value']);
        expect(check.issues[0]).toMatchObject({ path: 'metodos', code: 'shape' });
    });

    it('solo requisitos que admiten copilot_approved y se guardan como valor', () => {
        expect(isCopilotRequirement(spec, PAYMENT)).toBe(true);
        const ownerOnly = spec.order.find(id => spec.requirements[id].sources.allowed.every(s => s === 'owner_form'))!;
        expect(isCopilotRequirement(spec, ownerOnly)).toBe(false);
        expect(checkCopilotProposal(spec, { requirementId: ownerOnly, value: {}, evidence: [] }, SOURCES).rejections[0].code).toBe('not_copilot_source');
        expect(checkCopilotProposal(spec, { requirementId: 'CORE.NOPE.X', value: {}, evidence: [] }, SOURCES).rejections[0].code).toBe('unknown_requirement');
    });

    it('compara valores sin importar el orden de las claves', () => {
        expect(sameCopilotValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
        expect(sameCopilotValue({ methods: ['efectivo'] }, { methods: ['tarjeta_débito'] })).toBe(false);
    });
});

describe('copiloto: una propuesta nunca cuenta para la preparación', () => {
    it('el motor evalúa solo la foto: verificar y guardar propuestas no cambia el resultado', () => {
        const snapshot = base('clinica_dental');
        const before = evaluate(spec, snapshot, NOW);
        const check = checkCopilotProposal(spec, {
            requirementId: PAYMENT, value: { methods: ['efectivo'] },
            evidence: [{ source_ref: 'S1', quote: 'Aceptamos efectivo, tarjeta débito' }],
        }, SOURCES);
        expect(check.ok).toBe(true);
        const after = evaluate(spec, snapshot, NOW);
        expect(after.resultHash).toBe(before.resultHash);
        expect(after.requirements.find(r => r.id === PAYMENT)?.valueState).toBe('ausente');
        // la foto no tiene lugar para propuestas: solo valores, ítems, textos y hechos de plataforma
        expect(Object.keys(snapshot)).not.toContain('proposals');
    });
});

describe('copiloto: contenido genérico', () => {
    it('FAQ sembrada, de ejemplo o sin dato → pregunta al dueño; con dato → nada', () => {
        expect(genericTextReason({ body: 'Con gusto te compartimos la información, escríbenos.', contentStatus: 'confirmed' })).toBe('without_data');
        expect(genericTextReason({ body: 'Abrimos de lunes a viernes de 8:00 a 18:00 en Chapinero.', contentStatus: 'seeded' })).toBe('seeded');
        expect(genericTextReason({ body: 'Abrimos de lunes a viernes de 8:00 a 18:00 en Chapinero.', contentStatus: 'example' })).toBe('example');
        expect(genericTextReason({ body: 'Abrimos de lunes a viernes de 8:00 a 18:00 en Chapinero.', contentStatus: 'confirmed' })).toBeNull();
    });
});
