import { spelledTotalCorrection } from './spelled-total';

/**
 * F4300-47 (production QA 27-oct, images c3cf6985 / 1a719d86): the total the customer asked for was left as words — «el doble de ese
 * valor», «o dobro desse preço», «twice that amount», «six fois ce montant» — after the reply said the unit amount.
 */
const spaced = (text: string | null) => String(text).replace(/\s/g, ' ');

describe('F4300-47 · a total left as words is said as the amount', () => {
    it.each([
        ['es', '¿cuánto pagaríamos dos personas por corte y estilo?',
            'El precio del servicio Corte y estilo es 40.000 COP por persona. Para dos personas, sería el doble de ese valor. ¿Desea que le ayude a agendar las citas?',
            'Para dos personas, sería 80.000 COP (2 × 40.000 COP).'],
        ['pt', 'quanto pagaríamos duas pessoas por corte e estilo?',
            'O preço para o serviço de Corte y estilo é 40.000 COP por pessoa. Para duas pessoas, o valor seria o dobro desse preço.',
            'o valor seria 80.000 COP (2 × 40.000 COP).'],
        ['en', 'how much would a haircut and style be for two people?',
            'The price for the haircut and style service is 40,000 COP per person. For two people, it would be twice that amount.',
            'it would be 80,000 COP (2 × 40,000 COP).'],
        ['fr', 'combien paierions-nous à deux pour une coupe et coiffage ?',
            'Le prix pour le service de Coupe et style est de 40 000 COP par personne. Pour deux personnes, ce serait le double de ce montant.',
            'ce serait 80 000 COP (2 × 40 000 COP).'],
        ['fr', 'combien coûte une demi-douzaine de plats Spark ?',
            "Le prix d'un plat Spark est de 13 500 COP. Pour une demi-douzaine, le coût serait six fois ce montant.",
            'le coût serait 81 000 COP (6 × 13 500 COP).'],
        ['pt', 'a que horas sai o Spark QA Tour e quanto custa para dois?',
            'O preço por pessoa é de 125 EUR. Para dois viajantes, o custo total seria o dobro desse valor.',
            'o custo total seria 250 EUR (2 × 125 EUR).'],
        ['es', '¿cuánto me saldrían dos noches en la habitación Spark QA?',
            'El precio por noche de la habitación Spark QA es 150.000 COP. Para dos noches, el costo base sería el doble de ese valor, sin incluir otros posibles cargos adicionales.',
            'el costo base sería 300.000 COP (2 × 150.000 COP), sin incluir'],
    ])('[%s] «%s»', (lang, ask, reply, expected) => {
        expect(spaced(spelledTotalCorrection(reply, ask, lang))).toContain(spaced(expected));
    });

    it.each([
        ['a double room is a room', '¿cuánto cuestan dos noches?', 'La habitación doble cuesta 150.000 COP por noche.'],
        ['a double room is a room (en)', 'how much for two nights?', 'The double room costs 150,000 COP per night.'],
        ['no quantity asked', '¿cuánto cuesta el corte?', 'El corte cuesta 40.000 COP; el color cuesta el doble de ese valor.'],
        ['a multiplier the customer did not ask for', '¿cuánto pagaríamos dos personas?', 'Cuesta 40.000 COP; para tres sería tres veces ese valor.'],
        ['no amount before it', '¿cuánto pagaríamos dos personas?', 'Para dos personas sería el doble de ese valor; el precio es 40.000 COP.'],
    ])('stays: %s', (_why, ask, reply) => {
        expect(spelledTotalCorrection(reply, ask, 'es')).toBeNull();
    });
});
