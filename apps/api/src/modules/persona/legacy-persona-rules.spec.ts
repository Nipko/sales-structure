import { PersonaService } from './persona.service';
import {
    DENTAL_ASSESSMENT_RULE,
    DENTAL_REASON_RULE,
    DENTAL_ROUTINE_BOOKING_RULE,
    LEGACY_PERSONA_RULE_REWRITES,
    REAL_ESTATE_PUBLISHED_PRICE_RULE,
    rewriteLegacyPersonaRule,
} from './legacy-persona-rules';
import { escapeXmlText } from '../../common/utils/xml.util';

// QA producción (oct-2026): con esta regla copiada en config_json el agente
// inmobiliario decía que el precio "no está confirmado" justo después de que
// search_listings devolviera price 250000 EUR con priceStatus 'confirmed'.
const LEGACY = 'NUNCA prometas precio final ni descuentos — el asesor confirma en la visita';

describe('real-estate published price rule', () => {
    const service = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);

    const listingsTemplate = () => (service.getVerticalTemplates('inmobiliaria', 'es') || [])
        .find((template: any) => template.id === 'tpl_inmobiliaria_listings');

    it('the catalog template tells the agent to give the published price and no longer withholds it', () => {
        const rules: string[] = listingsTemplate()!.config_json.behavior.rules;
        expect(rules).not.toContain(LEGACY);
        expect(rules).toContain(REAL_ESTATE_PUBLISHED_PRICE_RULE);
        expect(rules.some(rule => /NUNCA prometas precio final/i.test(rule))).toBe(false);
        expect(REAL_ESTATE_PUBLISHED_PRICE_RULE).toMatch(/precio publicado[^;]*search_listings[^;]*get_listing_details/);
        expect(REAL_ESTATE_PUBLISHED_PRICE_RULE).toMatch(/NUNCA prometas descuentos/);
    });

    it('no built-in or vertical template in any language ships the legacy rule', () => {
        for (const lang of ['es', 'en', 'pt', 'fr']) {
            const all = [...service.getBuiltinTemplates(lang), ...(service.getVerticalTemplates('inmobiliaria', lang) || [])];
            for (const template of all) expect(template.config_json?.behavior?.rules ?? []).not.toContain(LEGACY);
        }
    });

    it('an existing persona that stored the legacy rule renders the new wording, and a custom rule is untouched', () => {
        const custom = 'Saluda siempre por el nombre del cliente';
        const prompt = service.buildSystemPrompt({
            persona: { name: 'Carlos', role: 'Asesor inmobiliario', personality: {} },
            behavior: { rules: [custom, LEGACY] },
        } as any);
        expect(prompt).toContain(`<rule>${escapeXmlText(REAL_ESTATE_PUBLISHED_PRICE_RULE)}</rule>`);
        expect(prompt).not.toContain(LEGACY);
        expect(prompt).toContain(`<rule>${custom}</rule>`);
        expect(prompt.indexOf(custom)).toBeLessThan(prompt.indexOf('precio publicado'));
    });

    it('rewrites only an exact match, never a rule with similar words', () => {
        const similar = [
            'NUNCA prometas precio final ni descuentos',
            'NUNCA prometas precio final ni descuentos — el asesor confirma en la visita, salvo promociones vigentes',
            'nunca prometas precio final ni descuentos — el asesor confirma en la visita',
            'No prometas descuentos; el asesor confirma el precio final en la visita',
        ];
        for (const rule of similar) expect(rewriteLegacyPersonaRule(rule)).toBe(rule);
        expect(rewriteLegacyPersonaRule(`  ${LEGACY} `)).toBe(REAL_ESTATE_PUBLISHED_PRICE_RULE);
        expect(rewriteLegacyPersonaRule(LEGACY)).toBe(REAL_ESTATE_PUBLISHED_PRICE_RULE);
        expect(rewriteLegacyPersonaRule('toString')).toBe('toString');
        expect(Object.keys(LEGACY_PERSONA_RULE_REWRITES)).toContain(LEGACY);

        const prompt = service.buildSystemPrompt({
            persona: { name: 'Carlos', role: 'Asesor', personality: {} },
            behavior: { rules: similar },
        } as any);
        for (const rule of similar) expect(prompt).toContain(`<rule>${escapeXmlText(rule)}</rule>`);
        expect(prompt).not.toContain('precio publicado');
    });
});


// QA producción (oct-2026, tenant dental, gpt-4.1-mini): con un catálogo de
// solo Consulta general / Consulta especializada / Control y seguimiento, el
// agente respondía "Sí, ofrecemos tratamiento de ortodoncia" y "Sí, realizamos
// tratamientos de implantes dentales". La causa era la regla de la plantilla
// dental copiada en config_json, no las FAQs.
const LEGACY_DENTAL_ASSESSMENT = 'Para ortodoncia/blanqueamiento/tratamientos: ofrece valoración previa de 30min';
const LEGACY_DENTAL_REASON = 'Pregunta el motivo: ¿limpieza de rutina, dolor, tratamiento estético, ortodoncia?';
const LEGACY_DENTAL_ROUTINE = 'Para limpieza/control rutinario: agenda directamente desde el calendario';
const DENTAL_REWRITES: Array<[string, string]> = [
    [LEGACY_DENTAL_ASSESSMENT, DENTAL_ASSESSMENT_RULE],
    [LEGACY_DENTAL_REASON, DENTAL_REASON_RULE],
    [LEGACY_DENTAL_ROUTINE, DENTAL_ROUTINE_BOOKING_RULE],
];

describe('dental template rules tie every treatment to the service catalogue', () => {
    const service = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);

    const dentalTemplate = (lang = 'es') => (service.getVerticalTemplates('salud', lang) || [])
        .find((template: any) => template.id === 'tpl_salud_dental');

    it('the dental template no longer names orthodontics or whitening as offered and ships the catalogue rules', () => {
        const template = dentalTemplate()!;
        const rules: string[] = template.config_json.behavior.rules;
        for (const [legacy, current] of DENTAL_REWRITES) {
            expect(rules).not.toContain(legacy);
            expect(rules).toContain(current);
        }
        for (const rule of rules) expect(rule).not.toMatch(/ortodoncia|blanqueamiento|implante/i);
        expect(template.description).not.toMatch(/ortodoncia|blanqueamiento/i);
        expect(DENTAL_ASSESSMENT_RULE).toMatch(/está en el catálogo de servicios[^;]*valoración previa de 30 min/);
        expect(DENTAL_ASSESSMENT_RULE).toMatch(/si no está en el catálogo, di que no lo ofrecemos y muestra los servicios que sí hay/);
    });

    it('no salud template in any language ships a legacy dental rule', () => {
        for (const lang of ['es', 'en', 'pt', 'fr']) {
            const all = [...service.getBuiltinTemplates(lang), ...(service.getVerticalTemplates('salud', lang) || [])];
            for (const template of all) {
                const rules: string[] = template.config_json?.behavior?.rules ?? [];
                for (const [legacy] of DENTAL_REWRITES) expect(rules).not.toContain(legacy);
            }
        }
    });

    it('a persona that stored the legacy dental rules renders the new wording, and a custom rule is untouched', () => {
        const custom = 'Ofrecemos ortodoncia invisible con valoración gratuita';
        const prompt = service.buildSystemPrompt({
            persona: { name: 'Sofía', role: 'Asistente de recepción odontológica', personality: {} },
            behavior: { rules: [custom, ...DENTAL_REWRITES.map(([legacy]) => legacy)] },
        } as any);
        for (const [legacy, current] of DENTAL_REWRITES) {
            expect(prompt).not.toContain(legacy);
            expect(prompt).toContain(`<rule>${escapeXmlText(current)}</rule>`);
        }
        expect(prompt).not.toContain('ortodoncia/blanqueamiento');
        expect(prompt).toContain(`<rule>${escapeXmlText(custom)}</rule>`);
    });

    it('rewrites only exact matches, never a dental rule with similar words', () => {
        const similar = [
            'Para ortodoncia/blanqueamiento/tratamientos: ofrece valoración previa de 30min gratis',
            'para ortodoncia/blanqueamiento/tratamientos: ofrece valoración previa de 30min',
            'Para ortodoncia/blanqueamiento: ofrece valoración previa de 30min',
            'Para ortodoncia y blanqueamiento ofrece valoración previa de 30 min',
            'Pregunta el motivo: ¿limpieza de rutina, dolor, ortodoncia?',
            'Para limpieza/control rutinario: agenda directamente desde el calendario y confirma por WhatsApp',
        ];
        for (const rule of similar) expect(rewriteLegacyPersonaRule(rule)).toBe(rule);
        for (const [legacy, current] of DENTAL_REWRITES) {
            expect(rewriteLegacyPersonaRule(legacy)).toBe(current);
            expect(rewriteLegacyPersonaRule(`  ${legacy}
`)).toBe(current);
        }
        expect(Object.keys(LEGACY_PERSONA_RULE_REWRITES).sort()).toEqual(
            [LEGACY, ...DENTAL_REWRITES.map(([legacy]) => legacy)].sort(),
        );

        const prompt = service.buildSystemPrompt({
            persona: { name: 'Sofía', role: 'Recepción', personality: {} },
            behavior: { rules: similar },
        } as any);
        for (const rule of similar) expect(prompt).toContain(`<rule>${escapeXmlText(rule)}</rule>`);
        expect(prompt).not.toContain('catálogo de servicios');
    });

    it('the rewritten wording is idempotent', () => {
        for (const [, current] of DENTAL_REWRITES) expect(rewriteLegacyPersonaRule(current)).toBe(current);
    });
});
