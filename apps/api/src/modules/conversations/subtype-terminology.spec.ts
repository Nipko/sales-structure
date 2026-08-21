import {
    SUBTYPE_TERMINOLOGY,
    SUBTYPE_TERMINOLOGY_IDS,
    TERMINOLOGY_LANGUAGES,
    avoidedTermsFor,
    listVerticalCapabilityConfigurations,
    localizedTerm,
    subtypeTerminologyFor,
    type LocalizedTerm,
} from '@parallext/shared';
import { PromptAssemblerService } from './prompt-assembler.service';

/**
 * Cada perfil llama a las cosas por su nombre.
 *
 * La terminología vivía a nivel industria: 18 juegos de sustantivos para 76
 * negocios. Un hotel y un alquiler vacacional comparten "Turismo" y no
 * comparten casi nada más — el primero vende habitaciones-noche y el segundo
 * una casa entera; a los dos la aplicación les decía "Propiedades". La palabra
 * equivocada no es cosmética: es lo que el agente le dice al cliente.
 */
describe('subtype terminology pack', () => {
    const CANONICAL = new Set(
        listVerticalCapabilityConfigurations()
            .filter((manifest) => manifest.subtype)
            .map((manifest) => `${manifest.industry}/${manifest.subtype}`),
    );

    it('only names profiles that exist in the canonical registry', () => {
        expect(SUBTYPE_TERMINOLOGY_IDS.length).toBeGreaterThan(0);
        for (const id of SUBTYPE_TERMINOLOGY_IDS) {
            expect(CANONICAL.has(id)).toBe(true);
        }
    });

    /**
     * Una traducción faltante deja al tenant leyendo español dentro de una
     * interfaz en otro idioma — el mismo defecto que ya se corrigió en las
     * etiquetas del embudo.
     */
    it('gives every declared noun its four languages', () => {
        const nounKeys = [
            'primaryObject', 'primaryObjectPlural',
            'transactionNoun', 'customerNoun', 'customerNounPlural',
        ] as const;
        for (const [id, pack] of Object.entries(SUBTYPE_TERMINOLOGY)) {
            for (const key of nounKeys) {
                const term = pack[key] as LocalizedTerm | undefined;
                if (!term) continue;
                for (const language of TERMINOLOGY_LANGUAGES) {
                    expect(`${id}.${key}.${language}=${term[language] || ''}`)
                        .not.toMatch(/=$/);
                }
            }
        }
    });

    it('resolves a term in the requested language and falls back to Spanish', () => {
        const hotel = subtypeTerminologyFor('turismo', 'hotel');
        expect(localizedTerm(hotel?.primaryObject, 'pt')).toBe('Quarto');
        expect(localizedTerm(hotel?.primaryObject, 'de')).toBe('Habitación');
        expect(localizedTerm(hotel?.primaryObject, undefined)).toBe('Habitación');
        expect(localizedTerm(undefined, 'es')).toBeNull();
    });

    it('separates the three tourism businesses the industry noun collapsed', () => {
        expect(localizedTerm(subtypeTerminologyFor('turismo', 'hotel')?.primaryObject, 'es'))
            .toBe('Habitación');
        expect(localizedTerm(subtypeTerminologyFor('turismo', 'alquiler_vacacional')?.primaryObject, 'es'))
            .toBe('Alojamiento');
        expect(localizedTerm(subtypeTerminologyFor('turismo', 'tours')?.primaryObject, 'es'))
            .toBe('Tour');
    });

    /** El silencio es una decisión: ese subtipo usa bien el término de su vertical. */
    it('returns nothing for a profile with no word of its own', () => {
        expect(subtypeTerminologyFor('salud', 'dental')).toBeNull();
        expect(subtypeTerminologyFor('turismo', null)).toBeNull();
        expect(subtypeTerminologyFor(null, 'hotel')).toBeNull();
        expect(avoidedTermsFor('salud', 'dental')).toEqual([]);
    });

    /**
     * Lo que NO se dice. Un sustantivo prestado de otro rubro promete algo que
     * el perfil no hace: una dark kitchen no tiene mesa que reservar y una
     * farmacia no atiende pacientes por chat.
     */
    it('names the words each profile must not use with a customer', () => {
        expect(avoidedTermsFor('restaurantes', 'dark_kitchen')).toContain('reserva de mesa');
        expect(avoidedTermsFor('salud', 'farmacia')).toContain('paciente');
        expect(avoidedTermsFor('automotriz', 'taller')).toContain('prueba de manejo');
        expect(avoidedTermsFor('pet_services', 'guarderia')).toContain('diagnóstico');
    });

    /** Una palabra prohibida que el propio perfil usa como sustantivo sería una contradicción. */
    it('never forbids a word the same profile is told to use', () => {
        for (const [id, pack] of Object.entries(SUBTYPE_TERMINOLOGY)) {
            const nouns = new Set(
                [pack.primaryObject, pack.primaryObjectPlural, pack.transactionNoun,
                    pack.customerNoun, pack.customerNounPlural]
                    .filter(Boolean)
                    .flatMap((term) => TERMINOLOGY_LANGUAGES.map((l) => (term as LocalizedTerm)[l].toLowerCase())),
            );
            for (const avoided of pack.avoid || []) {
                expect(`${id}:${avoided}`).not.toBe(`${id}:${[...nouns].find((n) => n === avoided.toLowerCase()) || ''}`);
            }
        }
    });
});

describe('terminology in the assembled turn', () => {
    // El assembler sólo necesita al persona service para el bloque de persona,
    // que acá se devuelve vacío: lo que se verifica es el turno.
    const assembler = new PromptAssemblerService({
        buildSystemPrompt: () => '<persona></persona>',
    } as any);
    const config = {
        persona: { name: 'A', role: 'B', personality: {} },
        behavior: {},
    } as any;

    it('carries the profile noun and the avoid-list into the prompt', () => {
        const prompt = assembler.assemble(config, {
            verticalContext: {
                industry: 'restaurantes',
                subType: 'dark_kitchen',
                primaryObjectNoun: 'Pedido',
                primaryObjectNounPlural: 'Pedidos',
                avoidTerms: ['reserva de mesa', 'salón'],
            },
        } as any);

        expect(prompt).toContain('<primary_object_noun>Pedido</primary_object_noun>');
        expect(prompt).toContain('<primary_object_noun_plural>Pedidos</primary_object_noun_plural>');
        expect(prompt).toContain('<avoid_terms>reserva de mesa | salón</avoid_terms>');
    });

    /** Sin términos propios el bloque no aparece: nada vacío que el modelo interprete. */
    it('omits the block for a profile with no word of its own', () => {
        const prompt = assembler.assemble(config, {
            verticalContext: { industry: 'salud', subType: 'dental' },
        } as any);

        expect(prompt).not.toContain('<primary_object_noun>');
        expect(prompt).not.toContain('<avoid_terms>');
    });
});
