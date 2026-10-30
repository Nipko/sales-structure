import { FACT_TTL_MS, type VerifiedFact } from './facts-ledger';
import { factTokenId, renderReplyFacts } from './fact-renderer';

/**
 * F4300-37: `agentRuntime.renderedFacts` was on for 28 minutes in 7 QA tenants (image 57da6e58, factsLedger on) and 7 of 12
 * measured cases got worse. Each production reply, replayed through the renderer:
 *   1. hotel EN — «The price of Spark QA Habitacion 20261018T113247Z is 0 COP»: the room's `cleaningFee: 0` was taken for its price;
 *   2. restaurant EN «how many orders have I made?» — an English price sentence nobody asked for, inside a Spanish reply;
 *   3. tours FR — a French template inside a Spanish reply;
 *   4. real estate PT / salon EN — the area (80 m²) and the duration (45 min) dropped with the sentence the price template replaced;
 *   5. menu ES «si pido dos platos Spark cuánto pago?» — the 27.000 total replaced by the unit price;
 *   6. record names with their technical stamp in the templates.
 */
const NOW = new Date('2026-10-24T15:00:00.000Z');
function fact(kind: VerifiedFact['kind'], subject: VerifiedFact['subject'], field: string, value: VerifiedFact['value'], extra: Partial<VerifiedFact> = {}): VerifiedFact {
    return { v: 1, kind, subject, field, value, source: { tool: 'test_read' }, observedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        expiresAt: new Date(NOW.getTime() + FACT_TTL_MS[kind]).toISOString(), ...extra };
}
const LOCALES: Record<string, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };
const render = (reply: string, facts: VerifiedFact[], language: string, customerText: string, extra: Record<string, unknown> = {}) =>
    renderReplyFacts({ reply, facts, now: NOW, language, locale: LOCALES[language], customerText, ...extra });
const token = (f: VerifiedFact) => `⟦fact:${factTokenId(f)}⟧`;
const confirmed = (currency: string) => ({ currency, priceStatus: 'confirmed' as const });

// get_property_details: nightPrice 150.000, cleaningFee 0, one status for both («confirmed») — the record's order.
const ROOM = { type: 'property', id: 'prop-spark', name: 'Spark QA Habitacion 20261018T113247Z' };
const nightPrice = fact('money', ROOM, 'nightPrice', 150000, confirmed('COP'));
const cleaningFee = fact('money', ROOM, 'cleaningFee', 0, confirmed('COP'));
const maxGuests = fact('attribute', ROOM, 'maxGuests', 2);
const room = [nightPrice, cleaningFee, maxGuests];

const DISH = { type: 'menu_item', id: 'dish-spark', name: 'Spark QA Plato 20261018T110518Z' };
const dishPrice = fact('money', DISH, 'price', 13500, confirmed('COP'));
const ORDER = { type: 'order', id: '0b1c2d3e-1111-4111-8111-111111111111' };
const orderTotal = fact('money', ORDER, 'totalAmount', 13500, { ...confirmed('COP'), source: { tool: 'list_my_orders' } });
const orders = fact('record_list', { type: 'orders', id: 'customer' }, 'records', ['0B1C2D3E cancelled'], { complete: true, total: 1, source: { tool: 'list_my_orders' } });

const TOUR = { type: 'package', id: 'pkg-spark', name: 'Spark QA Tour 20261018T2140Z' };
const tourPrice = fact('money', TOUR, 'price', 125, confirmed('EUR'));
const tourCapacity = fact('attribute', TOUR, 'capacity', 10);

const LISTING = { type: 'listing', id: 'lst-spark', name: 'Spark QA Inmueble 20261018T2220Z' };
const listingPrice = fact('money', LISTING, 'price', 250000, confirmed('EUR'));
const listingArea = fact('attribute', LISTING, 'area', 80);

const HAIRCUT = { type: 'service', id: 'svc-corte', name: 'Corte y estilo' };
const haircutPrice = fact('money', HAIRCUT, 'price', 40000, confirmed('COP'));
const haircutDuration = fact('attribute', HAIRCUT, 'durationMinutes', 45);

describe('F4300-37 · 1. the price of a record is its price field, never a 0 or a fee', () => {
    const ASK = "what's the nightly rate and max guests?";

    it('a correct nightly rate the model typed is kept with the rest of the answer', () => {
        const reply = 'The nightly rate for Spark QA Habitacion is 150,000 COP. It can accommodate up to 2 guests.';
        const out = render(reply, room, 'en', ASK);
        expect(out.text).toBe(reply);
        expect(out.fallbacks).toEqual([]);
    });

    it('a wrong amount is restated from nightPrice — never «0 COP» from cleaningFee — with the spoken name', () => {
        const out = render('The nightly rate for Spark QA Habitacion is 120,000 COP. It can accommodate up to 2 guests.', room, 'en', ASK);
        expect(out.text).toBe('The price of Spark QA Habitacion is 150,000 COP. It can accommodate up to 2 guests.');
        expect(out.text).not.toMatch(/\b0 COP|20261018T113247Z/);
        // Whatever the order of the record's fields.
        expect(render('It costs 99 COP per night.', [cleaningFee, nightPrice], 'en', ASK).text).toBe('The price of Spark QA Habitacion is 150,000 COP.');
    });

    it('a token of a 0 amount is never «0 COP»: in a sentence about the fee it is said in words (F4300-47, 29-oct), elsewhere it is missing', () => {
        const out = render(`The cleaning fee is ${token(cleaningFee)}.`, room, 'en', ASK);
        expect(out.text).toBe('The cleaning fee is free of charge.');
        expect(out.text).not.toMatch(/\b0 COP/);
        expect(out.fallbacks).toEqual([]);
        // A 0 cited where the sentence is not about the fee is still no amount at all.
        const priced = render(`The room costs ${token(cleaningFee)}.`, room, 'en', ASK);
        expect(priced.text).not.toMatch(/\b0 COP|free of charge/);
        expect(priced.fallbacks).toEqual([{ reason: 'missing_price' }]);
        expect(render(`The nightly rate is ${token(nightPrice)}.`, room, 'en', ASK).text).toBe('The nightly rate is 150,000 COP.');
        // Production QA 30-oct (hotel, French): «nettoyage» is the fee too; the night price of the same sentence is kept.
        const french = render(`Le prix par nuit pour cette chambre est de ${token(nightPrice)}, avec une tarification de nettoyage de ${token(cleaningFee)}.`,
            room, 'fr', 'Quel est le prix par nuit et quelles sont les commodités offertes ?');
        expect(french.fallbacks).toEqual([]);
        expect(french.text).toMatch(/150\s000\sCOP/u);
        expect(french.text).toContain('sans frais');
    });

    it('a record with only a 0 / fee amount has no price to restate', () => {
        expect(render('The room costs 90,000 COP.', [cleaningFee, maxGuests], 'en', ASK).text)
            .toBe("I'd rather not give you a figure I don't have confirmed in the system.");
    });
});

describe('F4300-37 · 2. no unrequested price sentence, one language per reply', () => {
    const ASK = 'how many orders have I made?';

    it('an order total the record holds is kept; the menu price is not appended', () => {
        const reply = 'Usted ha realizado un pedido, que fue cancelado. Fue por 13.500 COP. ¿Le gustaría hacer un nuevo pedido?';
        const out = render(reply, [dishPrice, orderTotal, orders], 'en', ASK);
        expect(out.text).toBe(reply);
    });

    it('an amount nobody asked about and no record backs goes with its sentence — no «The price of …» in its place', () => {
        const out = render('Usted ha realizado un pedido, que fue cancelado. Fue por 9.900 COP. ¿Le gustaría hacer un nuevo pedido?',
            [dishPrice, orderTotal, orders], 'en', ASK);
        expect(out.text).toBe('Usted ha realizado un pedido, que fue cancelado. ¿Le gustaría hacer un nuevo pedido?');
        expect(out.text).not.toMatch(/price|precio|Spark/i);
        expect(out.fallbacks).toEqual([{ reason: 'unrendered_amount' }]);
    });

    it('a template is written in the language of the rest of the reply (the language guard then rewrites it whole)', () => {
        const out = render('Usted ha realizado tres pedidos con nosotros y todos fueron cancelados. ¿Le gustaría hacer un nuevo pedido?', [orders], 'en', ASK);
        expect(out.text).toBe('Tiene 1 pedido registrado. ¿Le gustaría hacer un nuevo pedido?');
        // A reply in the turn's language keeps the turn's templates.
        expect(render('You have made three orders, all of them cancelled. Would you like to place a new order?', [orders], 'en', ASK).text)
            .toBe('You have 1 order on record. Would you like to place a new order?');
    });
});

describe('F4300-37 · 3. tours FR: a Spanish reply gets no French sentence in the middle', () => {
    const ASK = 'combien de places pour le Spark QA Tour et quel prix ?';

    it('the backed price is kept as written', () => {
        const reply = 'El Spark QA Tour tiene un máximo de 10 plazas disponibles para cada salida. El precio es de 125 EUR por persona. ¿Le gustaría reservar?';
        expect(render(reply, [tourPrice, tourCapacity], 'fr', ASK).text).toBe(reply);
    });

    it('an unbacked price is restated in the reply\'s language, with the spoken name', () => {
        const out = render('El Spark QA Tour tiene un máximo de 10 plazas disponibles para cada salida. El precio es de 130 EUR por persona. ¿Le gustaría reservar?',
            [tourPrice, tourCapacity], 'fr', ASK);
        expect(out.text).toBe('El Spark QA Tour tiene un máximo de 10 plazas disponibles para cada salida. El precio de Spark QA Tour es 125 EUR. ¿Le gustaría reservar?');
        expect(out.text).not.toMatch(/Le prix|20261018T2140Z/);
    });
});

describe('F4300-37 · 4. only the offending figure goes: area and duration stay', () => {
    it('real estate PT: a backed price and area are kept', () => {
        const reply = 'O preço do Spark QA Inmueble é 250.000 EUR e a área é de 80 m².';
        expect(render(reply, [listingPrice, listingArea], 'pt', 'qual o preço e a área do Spark QA Inmueble?').text).toBe(reply);
    });

    it('real estate PT: a wrong price is restated and the area is said with it', () => {
        const out = render('O preço do Spark QA Inmueble é 260.000 EUR e a área é de 80 m².', [listingPrice, listingArea], 'pt', 'qual o preço e a área do Spark QA Inmueble?');
        expect(out.text).toBe('O preço de Spark QA Inmueble é 250.000 EUR. Segundo a ficha, Spark QA Inmueble tem 80 m².');
        // A wrong area next to a backed price: the area is restated from the record and the price stays.
        const area = render('O preço do Spark QA Inmueble é 250.000 EUR e a área é de 95 m².', [listingPrice, listingArea], 'pt', 'qual o preço e a área do Spark QA Inmueble?');
        expect(area.text).toBe('O preço de Spark QA Inmueble é 250.000 EUR. Segundo a ficha, Spark QA Inmueble tem 80 m².');
        expect(area.fallbacks).toEqual([{ reason: 'unrendered_count' }]);
    });

    it('salon EN: a backed price and duration are kept; a wrong price keeps the duration', () => {
        const ASK = 'how much is a haircut and how long does it take?';
        const reply = 'A Corte y estilo costs 40,000 COP and takes 45 minutes.';
        expect(render(reply, [haircutPrice, haircutDuration], 'en', ASK).text).toBe(reply);
        expect(render('A Corte y estilo costs 35,000 COP and takes 45 minutes.', [haircutPrice, haircutDuration], 'en', ASK).text)
            .toBe('The price of Corte y estilo is 40,000 COP. Corte y estilo takes 45 minutes.');
    });
});

describe('F4300-37 · 5. computed totals, as in the price guard (#224)', () => {
    const ASK = 'si pido dos platos Spark cuánto pago?';

    it('quantity × unit price is a total the facts back, typed or around a token', () => {
        const typed = 'Dos platos Spark QA Plato serían 27.000 COP (13.500 COP cada uno).';
        expect(render(typed, [dishPrice], 'es', ASK).text).toBe(typed);
        const cited = render(`Dos platos serían 27.000 COP (${token(dishPrice)} cada uno).`, [dishPrice], 'es', ASK);
        expect(cited.text).toBe('Dos platos serían 27.000 COP (13.500 COP cada uno).');
        expect(cited.fallbacks).toEqual([]);
        // A sum of verified amounts: night price + cleaning fee of a stay.
        const fee = fact('money', ROOM, 'cleaningFee', 30000, confirmed('COP'));
        expect(render('In total, 180,000 COP for one night with cleaning.', [nightPrice, fee], 'en', 'how much for one night?').text)
            .toBe('In total, 180,000 COP for one night with cleaning.');
    });

    it('a total no quantity explains still falls back to the unit price', () => {
        expect(render('Dos platos serían 40.000 COP.', [dishPrice], 'es', ASK).text).toBe('El precio de Spark QA Plato es 13.500 COP.');
    });
});

describe('F4300-37 · the customer\'s form of address', () => {
    it('Spanish templates follow the tenant\'s register', () => {
        const usted = render('Usted ha hecho tres pedidos.', [orders], 'es', '¿Cuántos pedidos tengo?', { addressForm: 'usted' });
        expect(usted.text).toBe('Tiene 1 pedido registrado.');
        const tu = render('Has hecho tres pedidos.', [orders], 'es', '¿Cuántos pedidos tengo?', { addressForm: 'tu' });
        expect(tu.text).toBe('Tienes 1 pedido registrado.');
        // No regional pack: «usted», like the rest of the system's fixed texts.
        expect(render('Cuesta 9.000 COP.', [], 'es', '¿Cuánto cuesta?').text).toBe('Prefiero no darle una cifra que no tengo confirmada en el sistema.');
    });
});
