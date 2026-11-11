/**
 * ADR 0031 (recall del copiloto): en el dental el copiloto propuso 5 de 17 bloqueantes porque solo podía proponer los
 * requisitos con `copilot_approved`. Se abrieron los que son HECHOS que un negocio escribe en sus documentos, con los
 * mismos guardarraíles (cita literal, cifras citadas, aprobación del dueño) y, en los que mezclan hechos con decisiones,
 * solo los campos de hecho. Los que son decisiones de operación o de privacidad del dueño siguen cerrados.
 */
import {
    checkCopilotProposal, isCopilotRequirement, normalizeCopilotValue, COPILOT_FACT_SHAPES, copilotPromptShape, copilotPlaceholders,
    copilotValueAgrees, mergeCopilotValue, isCountryCode, isCurrencyCode, isIanaTimezone, isLanguageCode, type CopilotSource,
} from '../src/copilot';
import { readSpecDocs } from '../src/load';
import { spec } from './helpers';

const OPENED = [
    'CORE.IDENTITY.REGION', 'CORE.HANDOFF.HOURS_SLA', 'CORE.LANGUAGES.SERVED', 'CORE.PAYMENT.TIMING_DEPOSIT', 'CORE.PAYMENT.FINANCING',
    'CORE.PAYMENT.INVOICING', 'CORE.PRIVACY.NOTICE', 'CORE.CONTACT.SPECIAL', 'DOM.HEALTH.CLINICAL_SCOPE', 'DOM.HEALTH.EMERGENCY_PROTOCOL',
    'DOM.VETERINARY.EMERGENCY',
];
const OPENED_TEMPLATES = ['OBJ.*.CHANGE_RULES'];
// decisiones de operación o de privacidad del dueño: nunca las propone el copiloto
const CLOSED = ['DOM.HEALTH.SENSITIVE_DATA', 'CORE.PRIVACY.CUSTOMER_MEMORY', 'CORE.HANDOFF.ALWAYS_HUMAN', 'CORE.SAFETY.EMERGENCY_BASE', 'CORE.SAFETY.FORBIDDEN_TOPICS'];
const CLOSED_TEMPLATES = ['OBJ.*.WRITE_MODE', 'OBJ.*.ACCOUNT_READ', 'OBJ.*.AVAILABILITY_SOURCE'];
const instances = (template: string) => spec.order.filter(id => spec.requirements[id].templateId === template);
const PAYMENT = 'CORE.PAYMENT.METHODS';
const REGION = 'CORE.IDENTITY.REGION';

const CLINIC: CopilotSource = {
    ref: 'S2', kind: 'document', label: 'Clínica', url: null, origin: 'knowledge_documents:d2',
    text: [
        'Clínica Dental Sonrisa, Bogotá, Colombia. Precios en pesos colombianos (COP), hora de Colombia.',
        'Atendemos en español e inglés.',
        'Urgencias: llámanos al +57 300 123 4567 las 24 horas. Ofrecemos citas de urgencia el mismo día.',
        'Para reprogramar o cancelar tu cita escríbenos con 24 horas de anticipación.',
        'La ortodoncia y los implantes se cotizan en la valoración.',
        'Responsable de tus datos: Sonrisa SAS, datos@sonrisa.co. Política de privacidad: https://sonrisa.co/privacidad',
    ].join('\n'),
};
const SOURCES = new Map([[CLINIC.ref, CLINIC]]);
const cite = (quote: string) => [{ source_ref: 'S2', quote }];
const codes = (requirementId: string, value: unknown, quote: string) =>
    checkCopilotProposal(spec, { requirementId, value, evidence: cite(quote) }, SOURCES).rejections.map(r => r.code);

describe('copiloto: qué requisitos propone (ADR 0031, recall)', () => {
    it('cada requisito abierto es del copiloto', () => {
        for (const id of OPENED) expect([id, isCopilotRequirement(spec, id)]).toEqual([id, true]);
        for (const t of OPENED_TEMPLATES) {
            expect(instances(t).length).toBeGreaterThan(0);
            for (const id of instances(t)) expect([id, isCopilotRequirement(spec, id)]).toEqual([id, true]);
        }
    });

    it('los de decisión de operación o de privacidad del dueño no', () => {
        for (const id of CLOSED) expect([id, isCopilotRequirement(spec, id)]).toEqual([id, false]);
        for (const t of CLOSED_TEMPLATES) {
            expect(instances(t).length).toBeGreaterThan(0);
            for (const id of instances(t)) expect([id, isCopilotRequirement(spec, id)]).toEqual([id, false]);
        }
    });

    it('fuentes y canales van juntos en los abiertos: copilot_approved se recoge por copilot_extraction', () => {
        // el YAML crudo: la especificación compilada no guarda los canales
        const raw = new Map<string, any>();
        const walk = (node: unknown): void => {
            if (Array.isArray(node)) { node.forEach(walk); return; }
            if (!node || typeof node !== 'object') return;
            const r = node as Record<string, any>;
            if (typeof r.id === 'string' && r.sources && r.collection) raw.set(r.id, r);
            Object.values(r).forEach(walk);
        };
        walk(readSpecDocs());
        for (const id of [...OPENED, ...OPENED_TEMPLATES]) {
            const req = raw.get(id);
            expect([id, req?.sources?.allowed]).toEqual([id, expect.arrayContaining(['copilot_approved'])]);
            expect([id, req?.collection?.channels]).toEqual([id, expect.arrayContaining(['copilot_extraction'])]);
        }
        for (const id of [...CLOSED, ...CLOSED_TEMPLATES]) {
            expect([id, raw.get(id)?.sources?.allowed.includes('copilot_approved')]).toEqual([id, false]);
            expect([id, raw.get(id)?.collection?.channels.includes('copilot_extraction')]).toEqual([id, false]);
        }
    });
});

describe('copiloto: región', () => {
    it('país por nombre o código, zona IANA y moneda ISO; el pack de país no lo propone el copiloto', () => {
        const check = checkCopilotProposal(spec, {
            requirementId: REGION,
            value: { operating_country: 'Colombia', timezone: 'america/bogota', currency: 'cop', country_pack: 'CO@3' },
            evidence: cite('Clínica Dental Sonrisa, Bogotá, Colombia. Precios en pesos colombianos (COP)'),
        }, SOURCES);
        expect(check.rejections).toEqual([]);
        expect(check.value).toEqual({ operating_country: 'CO', timezone: 'America/Bogota', currency: 'COP' });
        // idempotente
        expect(normalizeCopilotValue(spec, REGION, check.value, { factsOnly: true }).value).toEqual(check.value);
    });

    it('lo que no valida se rechaza, nunca se adivina', () => {
        const quote = 'Clínica Dental Sonrisa, Bogotá, Colombia.';
        expect(codes(REGION, { operating_country: 'Colombialandia' }, quote)).toEqual(['invalid_value']);
        expect(codes(REGION, { operating_country: 'CO', timezone: 'GMT-5' }, quote)).toEqual(['invalid_value']);
        expect(codes(REGION, { operating_country: 'CO', timezone: 'Bogota' }, quote)).toEqual(['invalid_value']);
        expect(codes(REGION, { operating_country: 'CO', currency: '$' }, quote)).toEqual(['invalid_value']);
        expect(codes(REGION, { operating_country: 'CO', currency: 'XYZ' }, quote)).toEqual(['invalid_value']);
        expect(codes(REGION, { country_pack: 'CO@3' }, quote)).toEqual(['no_document_fact']);
        expect(isCountryCode('CO')).toBe(true);
        expect(isCountryCode('ZZ')).toBe(false);
        expect(isIanaTimezone('America/Bogota')).toBe(true);
        expect(isIanaTimezone('UTC')).toBe(false);
        expect(isCurrencyCode('COP')).toBe(true);
        expect(isLanguageCode('es-CO')).toBe(true);
    });

    it('el país no se infiere: si ninguna cita lo nombra, no hay propuesta', () => {
        expect(codes(REGION, { operating_country: 'MX' }, 'Clínica Dental Sonrisa, Bogotá, Colombia.')).toEqual(['country_without_quote']);
        expect(codes(REGION, { operating_country: 'CO' }, 'Atendemos en español e inglés.')).toEqual(['country_without_quote']);
    });
});

describe('copiloto: idiomas, urgencias, alcance clínico, cambios y privacidad', () => {
    it('idiomas: por nombre o código → códigos; los del agente son decisión del dueño', () => {
        const check = checkCopilotProposal(spec, {
            requirementId: 'CORE.LANGUAGES.SERVED',
            value: { human_languages: ['Español', 'inglés'], content_source_language: 'ES', agent_languages: ['es', 'en', 'pt'], translate_content: true },
            evidence: cite('Atendemos en español e inglés.'),
        }, SOURCES);
        expect(check.rejections).toEqual([]);
        expect(check.value).toEqual({ human_languages: ['es', 'en'], content_source_language: 'es' });
        expect(codes('CORE.LANGUAGES.SERVED', { human_languages: ['klingon'] }, 'Atendemos en español e inglés.')).toEqual(['invalid_value']);
    });

    it('urgencias de salud: la línea propia con su cita; las señales de alarma de la plataforma no las propone', () => {
        const quote = 'Urgencias: llámanos al +57 300 123 4567 las 24 horas. Ofrecemos citas de urgencia el mismo día.';
        const check = checkCopilotProposal(spec, {
            requirementId: 'DOM.HEALTH.EMERGENCY_PROTOCOL',
            value: { own_urgent_line: { kind: 'phone', value: '+57 300 123 4567', hours: '24 horas' }, urgent_slot: true, red_flags: ['dolor'] },
            evidence: cite(quote),
        }, SOURCES);
        expect(check.rejections).toEqual([]);
        expect(check.value).toEqual({ own_urgent_line: { kind: 'phone', value: '+57 300 123 4567', hours: '24 horas' }, urgent_slot: true });
        // un número que la cita no trae es inventado
        expect(codes('DOM.HEALTH.EMERGENCY_PROTOCOL', { own_urgent_line: { kind: 'phone', value: '+57 300 765 4321' } }, quote)).toEqual(['figure_without_quote']);
        // «WhatsApp» como línea no es un dato
        expect(codes('DOM.HEALTH.EMERGENCY_PROTOCOL', { own_urgent_line: { kind: 'whatsapp', value: 'WhatsApp' } }, quote)).toEqual(['placeholder_value']);
        expect(copilotPlaceholders('DOM.HEALTH.EMERGENCY_PROTOCOL', { own_urgent_line: { kind: 'whatsapp', value: 'WhatsApp' } })).toEqual(['whatsapp: «WhatsApp»']);
    });

    it('alcance clínico: solo los servicios que se definen en valoración (el descargo lo acepta el dueño)', () => {
        const check = checkCopilotProposal(spec, {
            requirementId: 'DOM.HEALTH.CLINICAL_SCOPE', value: { requires_assessment: ['Ortodoncia', 'Implantes'], disclaimer: 'No reemplaza la consulta' },
            evidence: cite('La ortodoncia y los implantes se cotizan en la valoración.'),
        }, SOURCES);
        expect(check.rejections).toEqual([]);
        expect(check.value).toEqual({ requires_assessment: ['Ortodoncia', 'Implantes'] });
    });

    it('modificar y cancelar: «solicitud» o «no» desde el documento; «directo» lo decide el dueño', () => {
        const [id] = instances('OBJ.*.CHANGE_RULES');
        const quote = 'Para reprogramar o cancelar tu cita escríbenos con 24 horas de anticipación.';
        const check = checkCopilotProposal(spec, {
            requirementId: id,
            value: { agent_can_modify: 'solicitud', agent_can_cancel: 'solicitud', terms: 'ref CORE.POLICY.CANCELLATION_CHANGES', ask_reason: true },
            evidence: cite(quote),
        }, SOURCES);
        expect(check.rejections).toEqual([]);
        expect(check.value).toEqual({ agent_can_modify: 'solicitud', agent_can_cancel: 'solicitud', terms: 'ref CORE.POLICY.CANCELLATION_CHANGES' });
        expect(codes(id, { agent_can_modify: 'directo', agent_can_cancel: 'solicitud' }, quote)).toEqual(['owner_decision']);
    });

    it('privacidad: responsable y enlace con su cita; la versión no la propone el copiloto', () => {
        const check = checkCopilotProposal(spec, {
            requirementId: 'CORE.PRIVACY.NOTICE',
            value: { controller: { name: 'Sonrisa SAS', email: 'datos@sonrisa.co' }, url_or_text: 'https://sonrisa.co/privacidad', version: 1 },
            evidence: cite('Responsable de tus datos: Sonrisa SAS, datos@sonrisa.co. Política de privacidad: https://sonrisa.co/privacidad'),
        }, SOURCES);
        expect(check.rejections).toEqual([]);
        expect(check.value).toEqual({ controller: { name: 'Sonrisa SAS', email: 'datos@sonrisa.co' }, url_or_text: 'https://sonrisa.co/privacidad' });
    });
});

describe('copiloto: lo que ve el modelo y lo que se aprueba', () => {
    it('los requisitos de hechos se le muestran en palabras del dueño, sin texto de desarrollador', () => {
        for (const [key, shape] of Object.entries(COPILOT_FACT_SHAPES)) {
            const id = key.startsWith('OBJ.*.') ? instances(key)[0] : key;
            expect([id, isCopilotRequirement(spec, id)]).toEqual([id, true]);
            const prompt = copilotPromptShape(spec, id);
            expect(prompt.structure).toEqual(shape.fields);
            expect([id, /ref pack|text_i18n|enum \[|union \[|id\+versión|ISO-3166|IANA\b(?! \()/.test(JSON.stringify(prompt.structure))]).toEqual([id, false]);
            // cada campo de hecho existe en la estructura del requisito
            const known = new Set(Object.keys(spec.requirements[id].data?.structure as Record<string, unknown>).map(k => k.replace(/\?$/, '')));
            for (const f of Object.keys(shape.fields)) expect([id, f, known.has(f)]).toEqual([id, f, true]);
        }
        // sin forma de hechos, la estructura de la especificación
        expect(copilotPromptShape(spec, PAYMENT).structure).toEqual(spec.requirements[PAYMENT].data?.structure);
    });

    it('aprobar sin editar conserva lo que el copiloto no propone; comparar mira solo lo propuesto', () => {
        const current = { operating_country: 'CO', timezone: 'America/Bogota', currency: 'COP', default_locale: 'es-CO', country_pack: 'CO@3' };
        expect(mergeCopilotValue(spec, REGION, current, { currency: 'USD' })).toEqual({ ...current, currency: 'USD' });
        expect(copilotValueAgrees(spec, REGION, { operating_country: 'CO', currency: 'COP' }, current)).toBe(true);
        expect(copilotValueAgrees(spec, REGION, { currency: 'USD' }, current)).toBe(false);
        // sin forma de hechos, la propuesta es el valor
        expect(mergeCopilotValue(spec, PAYMENT, { methods: ['efectivo'] }, { methods: ['Nequi'] })).toEqual({ methods: ['Nequi'] });
        expect(copilotValueAgrees(spec, PAYMENT, { methods: ['efectivo'] }, { methods: ['efectivo'], extra: 1 })).toBe(false);
    });
});
