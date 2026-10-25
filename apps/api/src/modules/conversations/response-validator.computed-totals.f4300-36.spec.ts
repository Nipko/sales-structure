import {
    buildUnverifiedPriceReply, enforceVerifiedPriceReply, quantitiesIn, ResponseValidatorService, unverifiedAmountNote,
    withoutUnverifiedPriceSentences,
} from './response-validator.service';
import { buildTrustedPriceCorpus } from './trusted-price-context';

/**
 * F4300-36 (production QA, restaurant Telegram tenant, image 57da6e58, agentRuntime.factsLedger on, 25-oct 11:08 UTC): «¿cuánto
 * cuesta el plato Spark? y si pido dos, cuánto sería?». The turn read get_menu (13.500 COP) and the reply sent was the whole
 * «No tengo un precio verificado en la información disponible…»: the computed total 27.000 COP (2 × 13.500) was not literally
 * in the turn's evidence, so it was read as an invented price — and the real 13.500 went with it.
 *
 * Now a total computed from verified amounts passes (an amount times a quantity the turn says, or the sum of 2–5 different
 * amounts), with rounding as the only tolerance; an unbacked amount takes out only its sentences when a verified price is
 * left, and invented prices are still caught.
 */
const validator = new ResponseValidatorService();
const MENU = { count: 3, items: [
    { id: 'dish-spark', name: 'Spark QA Plato', price: 13500, priceStatus: 'confirmed', currency: 'COP' },
    { id: 'drink-lemon', name: 'Limonada', price: 6000, priceStatus: 'confirmed', currency: 'COP' },
    { id: 'dessert', name: 'Postre', price: 9500, priceStatus: 'confirmed', currency: 'COP' },
] };
const corpus = buildTrustedPriceCorpus({}, [{ name: 'get_menu', result: MENU }]);
const PROPERTY = { properties: [{ id: 'p1', name: 'Cabaña Spark', nightPrice: 180000, cleaningFee: 40000, currency: 'COP' }] };
const propertyCorpus = buildTrustedPriceCorpus({}, [{ name: 'list_properties', result: PROPERTY }]);
const ASK_ES = '¿cuánto cuesta el plato Spark? y si pido dos, cuánto sería?';
const check = (reply: string, customerText = ASK_ES, input = corpus) => validator.validatePrices(reply, input, undefined, { customerText });

describe('F4300-36 quantities said in the turn', () => {
    it.each([
        ['y si pido dos, cuánto sería?', [2]],
        ['and if I order two?', [2]],
        ['e se eu pedir dois?', [2]],
        ['et si j’en commande deux ?', [2]],
        ['quiero 3 platos', [3]],
        ['tres noches', [3]],
        ['un par de limonadas', [2]],
        ['x4 por favor', [4]],
        ['2 margaritas', [2]],
    ])('«%s» → %j', (text, expected) => {
        expect(quantitiesIn(text)).toEqual(expected);
    });

    it('amounts, times, dates and percentages are not quantities', () => {
        expect(quantitiesIn('cuesta 13.500 COP')).toEqual([]);
        expect(quantitiesIn('a las 15:00')).toEqual([]);
        expect(quantitiesIn('el 25/10')).toEqual([]);
        expect(quantitiesIn('el 25 de octubre')).toEqual([]);
        expect(quantitiesIn('un 10% de descuento')).toEqual([]);
        expect(quantitiesIn('cuesta 1,5 kilos')).toEqual([]);
    });
});

describe('F4300-36 validatePrices: totals computed from verified amounts', () => {
    it('the production reply: 13.500 and 2 × 13.500 = 27.000 when the customer said «dos»', () => {
        expect(check('El plato Spark cuesta 13.500 COP. Si pide dos, serían 27.000 COP en total.')).toEqual({ ok: true, hallucinatedPrices: [] });
        // The quantity in the reply's own sentence is enough.
        expect(check('El plato cuesta 13.500 COP; dos platos serían 27.000 COP.', '¿y para mi pareja también?').ok).toBe(true);
    });

    it.each([
        ['en', 'how much is the Spark dish? and if I order two?', 'The Spark dish costs 13,500 COP. Two of them would be 27,000 COP.'],
        ['pt', 'quanto custa o prato Spark? e se eu pedir dois?', 'O prato Spark custa 13.500 COP. Dois pratos ficariam 27.000 COP.'],
        ['fr', 'combien coûte le plat Spark ? et si j’en prends deux ?', 'Le plat Spark coûte 13 500 COP. Pour deux, cela ferait 27 000 COP.'],
    ])('[%s] the same total in another language', (_lang, ask, reply) => {
        expect(check(reply, ask).ok).toBe(true);
    });

    it('an invented 15.000 with no basis is still blocked', () => {
        expect(check('El plato Spark cuesta 15.000 COP.')).toEqual({ ok: false, hallucinatedPrices: [15000] });
    });

    it('13.500 × 3 = 40.500 only when «3 / tres» was said', () => {
        expect(check('Tres platos serían 40.500 COP.', '¿y si pido tres?').ok).toBe(true);
        expect(check('Serían 40.500 COP.', 'quiero 3').ok).toBe(true);
        expect(check('Serían 40.500 COP.')).toEqual({ ok: false, hallucinatedPrices: [40500] });
        // «dos» was said: 13.500 + 13.500 is two, never three.
        expect(check('Serían 27.000 COP.', '¿cuánto sale?').ok).toBe(false);
    });

    it('a random 30.000 is not a total of anything read', () => {
        expect(check('Si pide dos, serían 30.000 COP.')).toEqual({ ok: false, hallucinatedPrices: [30000] });
    });

    it('the sum of different dishes read (dish + drink, dish + drink + dessert) passes', () => {
        expect(check('El plato con una limonada sería 19.500 COP.', 'el plato y una limonada').ok).toBe(true);
        expect(check('Todo junto: 29.000 COP.', 'plato, limonada y postre').ok).toBe(true);
        // Two dishes and a lemonade: one multiplied term plus another amount.
        expect(check('Dos platos y una limonada: 33.000 COP.', 'dos platos y una limonada').ok).toBe(true);
    });

    it('rounding is the only tolerance: no percentage or discount is derived', () => {
        expect(check('Serían 27.001 COP.').ok).toBe(true);
        expect(check('Con el 10% de descuento, dos platos serían 24.300 COP.').ok).toBe(false);
        expect(check('Serían 27.100 COP.').ok).toBe(false);
    });

    it('a total in another currency is not backed by COP amounts', () => {
        expect(check('Dos platos serían 27.000 USD.').ok).toBe(false);
    });

    it('hotel: nights × nightPrice (+ cleaning fee) when the number of nights is said', () => {
        expect(validator.validatePrices('3 noches serían 540.000 COP, más 40.000 COP de aseo: 580.000 COP en total.', propertyCorpus, undefined,
            { customerText: 'precio para 3 noches' }).ok).toBe(true);
        expect(validator.validatePrices('Three nights: 580,000 COP including cleaning.', propertyCorpus, undefined,
            { customerText: 'price for three nights?' }).ok).toBe(true);
        // No number of nights said: 580.000 is not computed from anything the turn says.
        expect(validator.validatePrices('El total es 580.000 COP.', propertyCorpus, undefined, { customerText: '¿cuánto cuesta?' }).ok).toBe(false);
    });

    it('without the customer text, the quantity in the reply sentence still counts; with none, the old rule stands', () => {
        expect(validator.validatePrices('Dos platos serían 27.000 COP.', corpus).ok).toBe(true);
        expect(validator.validatePrices('Serían 27.000 COP.', corpus).ok).toBe(false);
    });

    it('the ledger: a confirmed amount read in an earlier turn is a base for the total', () => {
        const facts = [{ kind: 'money', field: 'price', subjectType: 'menu_item', subjectId: 'dish-spark', subjectName: 'Spark QA Plato', value: 13500,
            currency: 'COP', priceStatus: 'confirmed' }] as any;
        expect(validator.validatePrices('Dos platos serían 27.000 COP.', '{}', { facts, customerText: '¿y si pido dos?' }).ok).toBe(true);
        expect(validator.validatePrices('Serían 31.000 COP.', '{}', { facts, customerText: '¿y si pido dos?' }).ok).toBe(false);
    });
});

describe('F4300-36 an unbacked amount takes out only its sentences', () => {
    const ES = '<language>es</language><address_form>usted</address_form>';

    it('the real price stays; the invented total goes, with the honest note', () => {
        const reply = 'El plato Spark cuesta 13.500 COP. Si pide dos, serían 30.000 COP.';
        const out = enforceVerifiedPriceReply(reply, corpus, ES, validator, undefined, undefined, { customerText: ASK_ES });
        expect(out).toMatchObject({ blocked: true, action: 'sentences' });
        expect(out.reply).toBe(`El plato Spark cuesta 13.500 COP. ${unverifiedAmountNote(ES)}`);
        expect(out.reply).not.toContain('30.000');
    });

    it('a closing question stays last', () => {
        const reply = 'El plato Spark cuesta 13.500 COP. Dos serían 31.000 COP. ¿Desea pedirlo?';
        const validation = check(reply);
        expect(withoutUnverifiedPriceSentences(reply, validation, corpus, ES, validator, undefined, 'tu', { customerText: ASK_ES }))
            .toBe(`El plato Spark cuesta 13.500 COP. ${unverifiedAmountNote(ES, 'tu')} ¿Desea pedirlo?`);
    });

    it.each([
        ['en', '<language>en</language>', 'The Spark dish costs 13,500 COP. Two would be 31,000 COP.', 'The Spark dish costs 13,500 COP.'],
        ['pt', '<language>pt</language>', 'O prato Spark custa 13.500 COP. Dois ficariam 31.000 COP.', 'O prato Spark custa 13.500 COP.'],
        ['fr', '<language>fr</language>', 'Le plat Spark coûte 13 500 COP. Deux feraient 31 000 COP.', 'Le plat Spark coûte 13 500 COP.'],
    ])('[%s] the same in another language', (_lang, system, reply, kept) => {
        const out = enforceVerifiedPriceReply(reply, corpus, system, validator, undefined, undefined, { customerText: '' });
        expect(out.reply).toBe(`${kept} ${unverifiedAmountNote(system)}`);
    });

    it('nothing verifiable left: the whole-reply template, as before', () => {
        const reply = 'El plato Spark cuesta 15.000 COP. ¡Buen provecho!';
        const out = enforceVerifiedPriceReply(reply, corpus, ES, validator, undefined, undefined, { customerText: ASK_ES });
        expect(out).toMatchObject({ blocked: true, action: 'template', reply: buildUnverifiedPriceReply(ES) });
        // The unverified amount and a verified one in the same sentence: the sentence goes, and nothing priced is left.
        const same = enforceVerifiedPriceReply('Cuesta 13.500 COP y dos serían 31.000 COP.', corpus, ES, validator, undefined, undefined, { customerText: ASK_ES });
        expect(same.action).toBe('template');
    });

    it('a verified reply is returned untouched', () => {
        const reply = 'El plato Spark cuesta 13.500 COP. Si pide dos, serían 27.000 COP.';
        expect(enforceVerifiedPriceReply(reply, corpus, ES, validator, undefined, undefined, { customerText: ASK_ES }))
            .toEqual({ reply, validation: { ok: true, hallucinatedPrices: [] }, blocked: false });
    });
});
