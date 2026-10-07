import { LISTINGS_TOOLS } from './tools/listings-tools';
import { verticalFlowGuidance } from './conversations.service';
import { VerticalTurnContextService } from './vertical-turn-context.service';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Clean-chat regression 2026-10-08 (inmobiliaria QA bot): «Busco apartamento en arriendo en Chapinero de 2
 * habitaciones» was answered with questions (budget, codeudor) and never with a search. The persona template said
 * "PRIMERO pregunta: comprar o arrendar, presupuesto, zona y habitaciones" and "para arriendo pregunta si tiene
 * codeudor", the vertical rules said "califica al prospecto", and nothing told the agent that the criteria it
 * already has are enough to call search_listings (the tool itself said «always ask» for rent/sale). Qualification
 * comes AFTER the first results.
 */
const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');
const tools = { realEstate: { enabled: true } };

describe('real estate: the criteria the customer gives are searched, not interrogated', () => {
    it('the flow guidance (live turn) tells the agent to call search_listings with what it has, before any qualification', () => {
        const guidance = verticalFlowGuidance('inmobiliaria', tools)!;
        expect(guidance).toMatch(/Apenas el cliente dé criterios de búsqueda/);
        expect(guidance).toMatch(/presupuesto, codeudor y datos personales NO son requisito para buscar/);
        expect(guidance).toMatch(/diga que no hay inmuebles con esos criterios/);
        expect(guidance.indexOf('search_listings')).toBeLessThan(guidance.indexOf('Para una visita'));
    });

    it.each(['es', 'en', 'pt', 'fr'] as const)('the same guidance exists in %s for the evaluated / localized turn', language => {
        const service = new VerticalTurnContextService({} as any, {} as any);
        const guidance: string = (service as any).flowGuidance('inmobiliaria', tools, language);
        expect(guidance).toContain('search_listings');
        expect(guidance.indexOf('search_listings')).toBeLessThan(guidance.search(/get_listing_details/));
        expect(guidance).toMatch(language === 'es' ? /NO son requisito/ : language === 'en' ? /NOT required/ : language === 'pt' ? /NÃO são requisito/ : /ne sont PAS requis/);
    });

    it('is only given to a real estate agent that has the tool', () => {
        expect(verticalFlowGuidance('inmobiliaria', {})).toBeUndefined();
        expect(verticalFlowGuidance('salon', tools)).toBeUndefined();
    });

    it('the tool says that rent / sale is read from the message and that nothing but the criteria is needed', () => {
        const tool = LISTINGS_TOOLS.find(t => t.name === 'search_listings')!;
        const kind = (tool.parameters as any).properties.transactionType.description as string;
        expect(kind).toMatch(/arriendo|alquiler|rent/i);
        expect(kind).not.toMatch(/Always ask if unclear/i);
        expect(tool.description).toMatch(/budget is optional/i);
        expect((tool.parameters as any).required ?? []).toEqual([]);
    });

    it('the persona template no longer makes budget and codeudor a precondition of searching', () => {
        const source = read('../persona/persona.service.ts');
        const rules = source.slice(source.indexOf('tpl_inmobiliaria_listings'), source.indexOf('tpl_inmobiliaria_listings') + 3500);
        expect(rules).not.toContain('PRIMERO pregunta: ¿comprar o arrendar?, presupuesto');
        expect(rules).toMatch(/search_listings de inmediato/i);
        expect(rules).toMatch(/después de mostrar opciones[^']*codeudor/i);
    });

    it('the vertical definition qualifies after showing options', () => {
        const source = read('../verticals/vertical-definitions.ts');
        const at = source.indexOf("rules: { es: 'Busca primero");
        expect(at).toBeGreaterThan(0);
        expect(source.slice(at, at + 400)).toMatch(/search_listings[^']*después califica/i);
    });
});
