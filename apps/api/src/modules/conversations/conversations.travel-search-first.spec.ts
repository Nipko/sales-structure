import { TOURS_TOOLS } from './tools/tours-tools';
import { VerticalTurnContextService, verticalFlowGuidance } from './vertical-turn-context.service';
import { PersonaService } from '../persona/persona.service';
import { normalizeRequiredFields } from '../persona/required-fields.util';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Agencia QA Viajes, 2026-10-09: «necesito su nombre completo y un número de contacto para avanzar con la
 * cotización» before showing a single package; «le recomiendo incluir el seguro» with no source; a departure date
 * that had already passed never mentioned. The travel template said «Pregunta destino, fechas, viajeros y
 * presupuesto», «Captura nombre completo, teléfono y email antes de armar la cotización» and «Recomienda seguro de
 * viaje cuando sea internacional», and the agent already created on 2026-10-02 keeps those saved rules.
 *
 * The runtime flow guidance is evaluated on EVERY turn, so it reaches agents that were created before the fix; the
 * template only reaches new ones.
 */
const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');
const tools = { tours: { enabled: true } };

describe('tours: the criteria the customer gives are searched, not interrogated', () => {
    const guidance = verticalFlowGuidance('turismo', tools)!;

    it('the flow guidance (live turn) searches with what the customer already said, before any data request', () => {
        expect(guidance).toMatch(/Apenas el cliente mencione/);
        expect(guidance).toMatch(/el destino es opcional y el nombre, el teléfono, el email y el presupuesto NO son requisito para buscar ni para mostrar paquetes/);
        expect(guidance.indexOf('search_packages')).toBeLessThan(guidance.indexOf('Recién cuando vaya a reservar pida nombre completo'));
        expect(guidance).toMatch(/Recién cuando vaya a reservar pida nombre completo, teléfono y email: check_package_availability/);
        expect(guidance.indexOf('Recién cuando vaya a reservar')).toBeLessThan(guidance.indexOf('create_tour_booking'));
    });

    it('an empty catalogue is voiced honestly instead of «I cannot search»', () => {
        expect(guidance).toMatch(/catalog_empty/);
        expect(guidance).toMatch(/todavía no publicó paquetes/);
        expect(guidance).toMatch(/nunca que no puede buscar/);
        expect(guidance).toMatch(/ofrezca que alguien del equipo lo contacte/);
        // «no match for these filters» stays a different answer.
        expect(guidance).toMatch(/diga que no hay paquetes con esos criterios \(la búsqueda sí se hizo\)/);
    });

    it('F4: a departure date earlier than today is said first, before any other question or handoff', () => {
        expect(guidance).toMatch(/fecha de salida anterior a hoy/);
        expect(guidance).toMatch(/«esa fecha ya pasó»/);
        expect(guidance).toMatch(/antes de cualquier otra pregunta o derivación \(también si pide un grupo grande\)/);
        // The tool confirms it, so the model passes the date even when it looks past.
        expect(guidance).toMatch(/pase la fecha a search_packages o check_package_availability/);
    });

    it('F2: no unsourced travel insurance and no official migration information', () => {
        expect(guidance).toMatch(/No recomiende seguros de viaje ni dé requisitos migratorios \(pasaporte, visa, vacunas\)/);
        expect(guidance).toMatch(/si no hay fuente, diga que el equipo lo confirma/);
    });

    it.each(['es', 'en', 'pt', 'fr'] as const)('the same policy exists in %s for the evaluated / localized turn', language => {
        const service = new VerticalTurnContextService({} as any, {} as any);
        const text: string = (service as any).flowGuidance('turismo', tools, language);
        expect(text).toContain('search_packages');
        expect(text).toContain('catalog_empty');
        expect(text.indexOf('search_packages')).toBeLessThan(text.indexOf('create_tour_booking'));
        expect(text).toMatch(language === 'es' ? /NO son requisito/ : language === 'en' ? /NOT required/ : language === 'pt' ? /NÃO são requisito/ : /ne sont PAS requis/);
        expect(text).toMatch(language === 'es' ? /ya pasó/ : language === 'en' ? /already passed/ : language === 'pt' ? /já passou/ : /déjà passée/);
        expect(text).toMatch(language === 'es' ? /seguros de viaje/ : language === 'en' ? /travel insurance/ : language === 'pt' ? /seguro viagem/ : /assurance voyage/);
    });

    it('is only given to a tours agent that has the tool, and real estate keeps its own policy', () => {
        expect(verticalFlowGuidance('turismo', {})).toBeUndefined();
        expect(verticalFlowGuidance('salon', tools)).toBeUndefined();
        expect(verticalFlowGuidance('inmobiliaria', { realEstate: { enabled: true } })).toMatch(/catalog_empty/);
    });

    it('search_packages tells the model that nothing is required to search, to pass a past date, and what catalog_empty means', () => {
        const tool = TOURS_TOOLS.find(t => t.name === 'search_packages')!;
        expect(tool.description).toMatch(/never ask for name, phone or email before searching/);
        expect(tool.description).toMatch(/even when it looks like it is in the past/);
        expect(tool.description).toMatch(/catalog_empty: true/);
        expect((tool.parameters as any).required ?? []).toEqual([]);
    });
});

describe('tours: the persona templates no longer make personal data a precondition of searching', () => {
    const persona = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);
    const template = (id: string) => persona.getVerticalTemplates('turismo', 'es')!.find((t: any) => t.id === id)!;

    it('tpl_turismo_agencia searches first, asks contact data only to book, never recommends insurance without a source', () => {
        const behavior = template('tpl_turismo_agencia').config_json.behavior;
        const rules: string[] = behavior.rules;
        expect(rules.join(' | ')).not.toContain('antes de armar la cotización');
        expect(rules.join(' | ')).not.toContain('Recomienda seguro de viaje cuando sea internacional');
        expect(rules.join(' | ')).not.toContain('Pregunta destino, fechas, número de viajeros y presupuesto aproximado');
        expect(rules[0]).toMatch(/USA search_packages de inmediato/);
        expect(rules[0]).toMatch(/NO necesitas nombre, teléfono ni email para buscar/);
        expect(rules.join(' | ')).toMatch(/solo cuando el cliente quiera reservar[^|]*nunca antes de mostrar paquetes o precios/);
        expect(rules.join(' | ')).toMatch(/ya pasó, dilo primero/);
        expect(rules.join(' | ')).toMatch(/NO recomiendes seguros de viaje ni des requisitos migratorios/);
        expect(behavior.forbiddenTopics).toEqual(expect.arrayContaining(['Información migratoria oficial', 'Recomendar seguros de viaje sin fuente']));
    });

    it('tpl_turismo_agencia keeps name and phone, but in a booking context and not the «general» one rendered on every turn', () => {
        const required = normalizeRequiredFields(template('tpl_turismo_agencia').config_json.behavior.requiredFields, { language: 'es', appointmentsEnabled: false });
        expect(Object.keys(required)).toEqual(['reserva']);
        expect(required.reserva.map(f => f.field)).toEqual(['name', 'phone']);
        expect(required.general).toBeUndefined();
    });

    it('tpl_turismo_tours no longer says «Pregunta SIEMPRE la fecha y número de personas antes de cotizar»', () => {
        const rules: string[] = template('tpl_turismo_tours').config_json.behavior.rules;
        expect(rules.join(' | ')).not.toContain('Pregunta SIEMPRE la fecha');
        expect(rules[0]).toMatch(/USA search_packages de inmediato/);
        expect(rules[0]).toMatch(/nunca nombre ni teléfono antes de mostrar opciones/);
    });

    it('the travel vertical definition (localized templates) searches first in the four languages', () => {
        const source = read('../verticals/vertical-definitions.ts');
        const at = source.indexOf("rules: { es: 'Busca primero: con lo que el viajero ya dijo");
        expect(at).toBeGreaterThan(0);
        const block = source.slice(at, at + 2400);
        expect(block).toMatch(/en: 'Search first:[^']*search_packages/);
        expect(block).toMatch(/pt: 'Busque primeiro:[^']*search_packages/);
        expect(block).toMatch(/fr: 'Cherchez d\\'abord[^']*search_packages/);
    });
});

describe('contract rules (every agent, whatever its saved persona rules say)', () => {
    const source = read('./prompt-assembler.service.ts');

    it('an empty catalogue is an answer and personal data never gates a CATALOGUE read', () => {
        expect(source).toMatch(/13d\. EMPTY CATALOGUE IS AN ANSWER: when a read tool returns catalog_empty=true/);
        expect(source).toMatch(/never tell the customer that you cannot search or that the tool is unavailable/);
        expect(source).toMatch(/13e\. CATALOGUE READS BEFORE ASKING: for a read of the business\\'s own OFFER \(search, details, availability or prices of listings, packages, products, menu, plans or services\), personal data \(name, phone, email\) and the items in <required_information> are never a precondition/);
        expect(source).toMatch(/A persona rule that asks for those details "before showing" or "before quoting" options does not apply to searching/);
    });

    it('customer-owned reads keep their identity and ownership requirements (13e does not relax them)', () => {
        const rule = source.slice(source.indexOf('13e. CATALOGUE READS BEFORE ASKING'), source.indexOf('13e. CATALOGUE READS BEFORE ASKING') + 1400);
        expect(rule).toMatch(/This does NOT relax customer-owned reads \(list_my_\*, get_my_\*, order, booking, enrolment, policy or claim status, treatment plans, pets\)/);
        expect(rule).toMatch(/those keep their identity, ownership and verification requirements/);
        // The rule no longer speaks of «a read-only tool» in general.
        expect(rule).not.toMatch(/precondition of a read-only tool/);
    });
});
