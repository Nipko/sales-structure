import { ResponseValidatorService } from './response-validator.service';

/**
 * F4300-48 (production QA 27-oct, menu tenant): «con 30.000 pesos, ¿me alcanza para dos platos Spark?» read the menu (Spark QA Plato
 * 13.500 COP) and the reply's answer was dropped: «¿Le gustaría hacer un pedido?», «Isso deixa um saldo restante, mas não suficiente
 * para um terceiro prato.», or only the allergen notice. The customer's own amount and what is left of it were taken for prices
 * nobody gave, and their sentence fell back to nothing.
 */
const validator = new ResponseValidatorService();
const MENU = '<menu><item name="Spark QA Plato" price="13500" currency="COP"/></menu>';

describe('F4300-48 · the customer\'s own amount and what is left of it are no invented price', () => {
    it.each([
        ['con 30.000 pesos, ¿me alcanza para dos platos Spark?', 'Sí, con 30.000 COP le alcanza: dos platos Spark cuestan 27.000 COP (2 × 13.500 COP) y le sobran 3.000 COP.'],
        ['com 30.000 pesos, dá para dois pratos Spark?', 'Sim: dois pratos custam 27.000 COP e sobram 3.000 COP dos seus 30.000 COP.'],
        ['with 30,000 pesos, can I get two Spark dishes?', 'Yes: two Spark dishes are 27,000 COP, leaving you 3,000 COP.'],
        ['le plat Spark coûte-t-il moins de 15 000 ?', 'Oui : le plat Spark coûte 13 500 COP, moins de 15 000 COP.'],
        ['¿el plato Spark vale más de 20 mil?', 'No: el plato Spark cuesta 13.500 COP, menos de 20.000 COP.'],
    ])('«%s»', (customerText, reply) => {
        expect(validator.validatePrices(reply, MENU, undefined, { customerText })).toEqual({ ok: true, hallucinatedPrices: [] });
    });

    it.each([
        // The customer's figure confirmed as the price, with no verified amount beside it.
        ['¿el plato Spark cuesta 50.000?', 'Sí, el plato Spark cuesta 50.000 COP.', 50000],
        // A remainder that no verified total gives.
        ['con 30.000 pesos, ¿me alcanza para dos platos Spark?', 'Dos platos cuestan 27.000 COP y le sobran 5.000 COP.', 5000],
        // An amount nobody said.
        ['¿cuánto cuesta el plato Spark?', 'El plato Spark cuesta 13.500 COP y el postre 8.000 COP.', 8000],
    ])('still invented: «%s»', (customerText, reply, amount) => {
        const result = validator.validatePrices(reply, MENU, undefined, { customerText });
        expect(result.ok).toBe(false);
        expect(result.hallucinatedPrices).toContain(amount);
    });
});
