import { budgetVerdictCorrection } from './budget-verdict';

/**
 * F4300-50 (production QA 28-oct, menu tenant): «con 30.000 pesos, ¿me alcanza para dos platos Spark?» → «no le alcanza… dos suman
 * 27.000 COP» (es) and «vous n'avez pas assez… 27 000 COP» (fr): a right total with the opposite verdict.
 */
const spaced = (text: string | null) => String(text).replace(/\s/g, ' ');

describe('F4300-50 · the enough / not-enough verdict is the one the figures give', () => {
    it.each([
        ['es', 'con 30.000 pesos, ¿me alcanza para dos platos Spark?',
            'Con 30.000 pesos no le alcanza para dos platos Spark, ya que cada uno cuesta 13.500 COP, y dos suman 27.000 COP. ¿Desea hacer un pedido de dos platos Spark?',
            'Sí, con 30.000 COP le alcanza: el total es 27.000 COP y le sobran 3.000 COP. ¿Desea hacer un pedido de dos platos Spark?'],
        ['fr', 'avec 30 000 pesos, puis-je prendre deux plats Spark ?',
            'Avec 30 000 pesos, vous n\'avez pas assez pour deux plats Spark, car chaque plat coûte 13 500 COP et deux totalisent 27 000 COP. Souhaitez-vous que je vous aide ?',
            'Oui, avec 30 000 COP c’est suffisant : le total est de 27 000 COP et il vous reste 3 000 COP. Souhaitez-vous que je vous aide ?'],
        ['en', 'with 30,000 pesos, can I get two Spark dishes?', 'Two Spark dishes come to 27,000 COP, so 30,000 is not enough.',
            'Yes, 30,000 COP is enough: the total is 27,000 COP, leaving 3,000 COP.'],
        ['es', 'con 20.000 pesos, ¿me alcanza para dos platos Spark?', 'Sí, le alcanza: dos platos suman 27.000 COP.',
            'No, con 20.000 COP no le alcanza: el total es 27.000 COP y le faltan 7.000 COP.'],
    ])('[%s] «%s»', (lang, ask, reply, expected) => {
        expect(spaced(budgetVerdictCorrection(reply, ask, lang))).toBe(spaced(expected));
    });

    it.each([
        ['the verdict is right', 'con 30.000 pesos, ¿me alcanza para dos platos Spark?', 'Sí, le alcanza: dos platos suman 27.000 COP.'],
        ['the verdict is right (pt)', 'com 30.000 pesos, dá para dois pratos Spark?', 'Sim, dá: dois pratos somam 27.000 COP.'],
        ['no budget said', '¿me alcanza para dos platos?', 'No le alcanza: dos platos suman 27.000 COP.'],
        ['no enough question', 'con 30.000 pesos, ¿qué me recomiendas?', 'No le alcanza para el menú completo de 45.000 COP.'],
        ['no total in the reply', 'con 30.000 pesos, ¿me alcanza para dos platos Spark?', 'No le alcanza, lo siento.'],
    ])('stays: %s', (_why, ask, reply) => {
        expect(budgetVerdictCorrection(reply, ask, 'es')).toBeNull();
    });
});
