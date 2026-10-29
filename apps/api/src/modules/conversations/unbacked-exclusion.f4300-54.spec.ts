import { unbackedExclusionCorrection } from './unbacked-exclusion';

/**
 * F4300-54 (production QA 28-oct): «the Spark QA Tour does not include photos / lunch», «el plato Spark no incluye postre»,
 * «n'inclut pas de dessert» — with no includes or excludes in the package read and nothing about it on the menu.
 */
const SPARK_TOUR = [{ name: 'get_package_details', result: { success: true, package: { name: 'Spark QA Tour', includes: [], excludes: [], durationValue: 4 } } }];
const AURORA_TOUR = [{ name: 'get_package_details', result: { success: true, package: { name: 'Tour QA Aurora', includes: ['Recorrido virtual con guía'], excludes: ['Transporte', 'Alojamiento'] } } }];
const MENU = [{ name: 'get_menu', result: { success: true, items: [{ name: 'Spark QA Plato', price: 13500, description: 'Plato sintético de prueba' }] } }];

describe('F4300-54 · an exclusion no read lists is said as «not recorded»', () => {
    it.each([
        ['en', 'The Spark QA Tour does not include photos as part of the package. It is a 4-hour tour guided in Spanish.', SPARK_TOUR,
            'Whether it includes photos is not recorded in the information I have. It is a 4-hour tour guided in Spanish.'],
        ['es', 'El Spark QA Tour no incluye almuerzo. Tiene una duración de 4 horas. ¿Le gustaría saber algo más?', SPARK_TOUR,
            'No consta en la información registrada si incluye almuerzo. Tiene una duración de 4 horas. ¿Le gustaría saber algo más?'],
        ['fr', "Le plat Spark QA n'inclut pas de dessert. Si vous souhaitez, je peux vous aider.", MENU,
            'Les informations enregistrées ne précisent pas si cela inclut dessert. Si vous souhaitez, je peux vous aider.'],
        ['pt', 'O prato Spark QA não inclui sobremesa. Posso ajudar com mais alguma coisa?', MENU,
            'Não consta na informação registrada se inclui sobremesa. Posso ajudar com mais alguma coisa?'],
    ])('[%s] %s', (lang, reply, reads, expected) => {
        expect(unbackedExclusionCorrection(reply, reads, lang)).toBe(expected);
    });

    it.each([
        ['a read that lists the exclusion', 'El Tour QA Aurora no incluye transporte ni alojamiento.', AURORA_TOUR],
        ['the reply translates the listed item (F4300-54 residue, 29-oct)', 'The Tour QA Aurora does not include transportation or accommodation.', AURORA_TOUR],
        ['a negation scoped to a recorded list', 'La habitación no incluye desayuno entre sus comodidades.', SPARK_TOUR],
        ['scoped to the description', 'La consulta general no incluye radiografía según la descripción del servicio.', SPARK_TOUR],
        ['no package or menu read', 'El Spark QA Tour no incluye almuerzo.', [{ name: 'search_faqs', result: { faqs: [] } }]],
        ['no negation', 'El Spark QA Tour dura 4 horas y se ofrece en español.', SPARK_TOUR],
    ])('stays: %s', (_why, reply, reads) => {
        expect(unbackedExclusionCorrection(reply, reads as any, 'es')).toBeNull();
    });

    it('a generic item says what is not recorded, not «si cela inclut inclusions»', () => {
        expect(unbackedExclusionCorrection("Le Spark QA Tour coûte 125 EUR par personne. Le forfait n'inclut pas d'inclusions ou d'exclusions spécifiques.", SPARK_TOUR, 'fr'))
            .toBe('Le Spark QA Tour coûte 125 EUR par personne. Les informations enregistrées ne précisent pas ce qui est inclus.');
    });
});
