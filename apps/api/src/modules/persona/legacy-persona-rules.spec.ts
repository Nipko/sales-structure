import { PersonaService } from './persona.service';
import { LEGACY_PERSONA_RULE_REWRITES, REAL_ESTATE_PUBLISHED_PRICE_RULE, rewriteLegacyPersonaRule } from './legacy-persona-rules';
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
        expect(Object.keys(LEGACY_PERSONA_RULE_REWRITES)).toEqual([LEGACY]);

        const prompt = service.buildSystemPrompt({
            persona: { name: 'Carlos', role: 'Asesor', personality: {} },
            behavior: { rules: similar },
        } as any);
        for (const rule of similar) expect(prompt).toContain(`<rule>${escapeXmlText(rule)}</rule>`);
        expect(prompt).not.toContain('precio publicado');
    });
});
