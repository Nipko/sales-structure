import { guardDescriptionStatusClaim, spokenItemName } from './description-authority';

/**
 * F4300-35, second follow-up: production after #217 (03d9fae9), Telegram QA tenants whose records carry a technical suffix
 * («Spark QA Habitacion 20261018T113247Z») and whose descriptions say «synthetic QA item, do not sell»:
 *  1. en hotel «can you describe the Spark QA Habitacion?» → «According to the catalogue, Spark QA Habitacion 20261018T113247Z is
 *     available. The room accommodates up to 2 guests…»; fr real estate «parlez-moi du Spark QA Inmueble» → «D'après le catalogue,
 *     Spark QA Inmueble 20261018T2220Z est disponible. Dans la ville de Spark QA Ciudad. Il dispose de 2 chambres…». The robotic
 *     availability sentence (with the stamp) was put in front whenever the removed text was the only one naming the item, and
 *     the complement of the removed clause was left standing as a verbless sentence;
 *  2. en tour «what does the Tour QA Aurora include?» → «… It does not include transportation or accommodation. Does not allow
 *     real bookings. Would you like…»: the coordinated remainder of «it is not a commercial offer and does not allow real
 *     bookings» survived, subjectless.
 */
const ROOM = { rooms: [{ name: 'Spark QA Habitacion 20261018T113247Z', description: 'Habitación sintética para pruebas, no comercializable.', maxGuests: 2, nightPrice: 180000 }] };
const LISTING = { listings: [{ name: 'Spark QA Inmueble 20261018T2220Z', description: 'Inmueble sintético de QA. No vender.', city: 'Spark QA Ciudad', bedrooms: 2 }] };
const TOUR = { packages: [{ name: 'Tour QA Aurora 20261018T2140Z', description: 'Tour sintético de QA. No es una oferta comercial y no permite reservas reales.', price: 125 }] };
const DISH = { items: [{ name: 'Spark QA Plato 20261018T113247Z', description: 'Plato sintético de QA para pruebas del agente. No vender.', price: 13500 }] };

describe('the record name as it is said', () => {
    it.each([
        ['Spark QA Habitacion 20261018T113247Z', 'Spark QA Habitacion'],
        ['Spark QA Inmueble 20261018T2220Z', 'Spark QA Inmueble'],
        ['Tour QA Aurora 2026-10-18', 'Tour QA Aurora'],
        ['Tour QA Aurora 2026-10-18T21:40:00Z', 'Tour QA Aurora'],
        ['Plato 20261018', 'Plato'],
        ['iPhone 15', 'iPhone 15'],
        ['Tour 2', 'Tour 2'],
        ['20261018T2220Z', '20261018T2220Z'],
    ])('%s → %s', (name, spoken) => expect(spokenItemName(name)).toBe(spoken));
});

describe('1. no «According to the catalogue … is available» in front, never the technical stamp', () => {
    it('en hotel (production): the next sentence needs no antecedent, nothing is put in front', () => {
        const reply = 'The Spark QA Habitacion is a synthetic room for QA purposes, not for commercial use. The room accommodates up to 2 guests and costs 180,000 COP per night.';
        const out = guardDescriptionStatusClaim({ reply, sources: [ROOM], lang: 'en' });
        expect(out).toMatchObject({ changed: true, action: 'removed' });
        expect(out.text).toBe('The room accommodates up to 2 guests and costs 180,000 COP per night.');
    });

    it('fr real estate (production): the verbless complement leads the next sentence, whose «Il» becomes the listing', () => {
        const reply = 'Le Spark QA Inmueble est un bien fictif de test, dans la ville de Spark QA Ciudad. Il dispose de 2 chambres et d’une salle de bain.';
        const out = guardDescriptionStatusClaim({ reply, sources: [LISTING], lang: 'fr' });
        expect(out.text).toBe('Dans la ville de Spark QA Ciudad, Spark QA Inmueble dispose de 2 chambres et d’une salle de bain.');
        expect(out.text).not.toMatch(/catalogue|disponible|2026|fictif/);
    });

    it('fr: «situé dans …» leads the next sentence too', () => {
        const reply = 'Le Spark QA Inmueble est un bien fictif de test, situé dans la ville de Spark QA Ciudad. Le bien dispose de 2 chambres.';
        const out = guardDescriptionStatusClaim({ reply, sources: [LISTING], lang: 'fr' });
        expect(out.text).toBe('Situé dans la ville de Spark QA Ciudad, le bien dispose de 2 chambres.');
    });

    it('fr: with no sentence after it, the complement closes the sentence before', () => {
        const reply = 'Le Spark QA Inmueble coûte 500 000 COP. C’est un bien fictif de test, dans la ville de Spark QA Ciudad.';
        const out = guardDescriptionStatusClaim({ reply, sources: [LISTING], lang: 'fr' });
        expect(out.text).toBe('Le Spark QA Inmueble coûte 500 000 COP, dans la ville de Spark QA Ciudad.');
    });

    it.each([
        ['en', 'The Spark QA Plato is a synthetic test dish. It costs 13,500 COP.', 'Spark QA Plato costs 13,500 COP.'],
        ['en', 'The Spark QA Plato is a synthetic test dish. It’s made with chicken and rice.', 'Spark QA Plato is made with chicken and rice.'],
        ['en', 'The Spark QA Plato is a synthetic test dish. Its price is 13,500 COP.', 'Spark QA Plato’s price is 13,500 COP.'],
        ['en', 'The Spark QA Plato is a synthetic test dish. There is no information about its ingredients.', 'As for Spark QA Plato, there is no information about its ingredients.'],
        ['es', 'El Spark QA Plato es un plato sintético de QA y no está a la venta. No se ha registrado información sobre sus ingredientes. ¿Te ayudo con algo más?',
            'En cuanto a Spark QA Plato, no se ha registrado información sobre sus ingredientes. ¿Te ayudo con algo más?'],
        ['es', 'El Spark QA Plato es un plato sintético de QA y no se vende. Sus ingredientes no están registrados.', 'En cuanto a Spark QA Plato, sus ingredientes no están registrados.'],
        ['pt', 'O Spark QA Plato é um item sintético de teste e não está à venda. Ele custa 13.500 COP.', 'Spark QA Plato custa 13.500 COP.'],
        ['fr', 'Le Spark QA Plato est un plat fictif de test. Il coûte 13 500 COP.', 'Spark QA Plato coûte 13 500 COP.'],
        ['fr', 'Le Spark QA Plato est un plat fictif de test. Ses ingrédients ne sont pas renseignés.', 'Quant à Spark QA Plato, ses ingrédients ne sont pas renseignés.'],
    ])('%s «%s» → the item is named in that sentence', (lang, reply, expected) => {
        const out = guardDescriptionStatusClaim({ reply, sources: [DISH], lang });
        expect(out.text).toBe(expected);
    });

    it.each([
        ['en', 'The Spark QA Plato is a synthetic test dish. It is important to confirm allergies with the staff.'],
        ['fr', 'Le Spark QA Plato est un plat fictif de test. Il y a du poulet et du riz.'],
        ['es', 'El Spark QA Plato es un plato sintético de QA y no se vende. Tampoco hay información de alérgenos.'],
        ['en', 'The Spark QA Plato is a synthetic test dish. Would you like to see its ingredients?'],
    ])('%s «%s»: no pronoun of the item opens it → nothing is put in front', (lang, reply) => {
        const out = guardDescriptionStatusClaim({ reply, sources: [DISH], lang });
        expect(out.action).toBe('removed');
        expect(out.text).not.toMatch(/Spark|catalog|catálogo|As for|En cuanto|Quant à|Quanto a/);
    });

    it('a pronoun after a sentence that kept the name is left alone', () => {
        const reply = 'The Spark QA Plato costs 13,500 COP. It is a synthetic test dish. It has chicken and rice.';
        expect(guardDescriptionStatusClaim({ reply, sources: [DISH], lang: 'en' }).text).toBe('The Spark QA Plato costs 13,500 COP. It has chicken and rice.');
    });

    it('nothing left: the fallback names the item without its stamp', () => {
        const out = guardDescriptionStatusClaim({ reply: 'The Spark QA Plato is a synthetic test dish and cannot be ordered.', sources: [DISH], lang: 'en' });
        expect(out).toMatchObject({ action: 'fallback', text: 'According to the catalogue, Spark QA Plato is available.' });
    });
});

describe('2. the coordinated remainder of a removed claim clause', () => {
    it('en tour (production): «… and does not allow real bookings» goes with the clause it continues', () => {
        const reply = 'The Tour QA Aurora includes a virtual tour. It does not include transportation or accommodation. '
            + 'It is not a commercial offer and does not allow real bookings. Would you like more details?';
        const out = guardDescriptionStatusClaim({ reply, sources: [TOUR], lang: 'en' });
        expect(out.text).toBe('The Tour QA Aurora includes a virtual tour. It does not include transportation or accommodation. Would you like more details?');
    });

    it.each([
        ['en', 'The Tour QA Aurora includes a virtual tour. It does not accept real orders.', 'The Tour QA Aurora includes a virtual tour.'],
        ['en', 'The Tour QA Aurora includes a virtual tour. It doesn\'t allow actual reservations.', 'The Tour QA Aurora includes a virtual tour.'],
        ['pt', 'O Tour QA Aurora inclui um passeio virtual. Não é uma oferta comercial e não permite fazer reservas reais.', 'O Tour QA Aurora inclui um passeio virtual.'],
        ['pt', 'O Tour QA Aurora inclui um passeio virtual. Não aceita compras reais.', 'O Tour QA Aurora inclui um passeio virtual.'],
        ['fr', 'Le Tour QA Aurora comprend une visite virtuelle. Ce n’est pas une offre commerciale et ne permet pas de réservations réelles.', 'Le Tour QA Aurora comprend une visite virtuelle.'],
        ['fr', 'Le Tour QA Aurora comprend une visite virtuelle. Il ne permet pas de faire de vraies réservations.', 'Le Tour QA Aurora comprend une visite virtuelle.'],
        ['es', 'El Tour QA Aurora incluye un recorrido virtual. No es una oferta comercial y no permite hacer reservas reales.', 'El Tour QA Aurora incluye un recorrido virtual.'],
    ])('%s «%s»', (lang, reply, expected) => {
        expect(guardDescriptionStatusClaim({ reply, sources: [TOUR], lang }).text).toBe(expected);
    });

    it('a predicate that is not a claim gets its subject back', () => {
        const reply = 'The Tour QA Aurora includes a virtual tour. It is a synthetic package and does not include transportation.';
        expect(guardDescriptionStatusClaim({ reply, sources: [TOUR], lang: 'en' }).text)
            .toBe('The Tour QA Aurora includes a virtual tour. It does not include transportation.');
    });

    it('a real-booking sentence about what the customer can do is not a claim without a test description', () => {
        const plain = { packages: [{ name: 'Tour Aurora', description: 'Recorrido por la ciudad.', price: 125 }] };
        const reply = 'The Tour Aurora includes a city walk. You can book it here.';
        expect(guardDescriptionStatusClaim({ reply, sources: [plain], lang: 'en' }).changed).toBe(false);
    });
});

describe('3. production QA 25-oct (image fe2edd65): «where is my order?» → «As for Spark QA Plato, however, this order was cancelled…»', () => {
    it('en: the «However» left by a removed sentence goes, and «on its way» is no possessive of the dish', () => {
        const reply = 'The Spark QA Plato 20261018T113247Z is a synthetic QA dish and is not for sale. However, this order was cancelled, so it is not on its way. If you want to place a new order, just let me know!';
        const out = guardDescriptionStatusClaim({ reply, sources: [DISH], lang: 'en' });
        expect(out).toMatchObject({ changed: true, action: 'removed' });
        expect(out.text).toBe('This order was cancelled, so it is not on its way. If you want to place a new order, just let me know!');
    });
    it('es / pt / fr: «Sin embargo», «Porém», «Cependant» after a removed sentence go too', () => {
        const cases: Array<[string, string, string]> = [
            ['El Spark QA Plato es un plato sintético de QA y no está a la venta. Sin embargo, ese pedido fue cancelado.', 'es', 'Ese pedido fue cancelado.'],
            ['O Spark QA Plato é um prato sintético de QA e não está à venda. Porém, esse pedido foi cancelado.', 'pt', 'Esse pedido foi cancelado.'],
            ["Le Spark QA Plato est un plat synthétique de QA et n'est pas à vendre. Cependant, cette commande a été annulée.", 'fr', 'Cette commande a été annulée.'],
        ];
        for (const [reply, lang, expected] of cases) {
            expect(guardDescriptionStatusClaim({ reply, sources: [DISH], lang }).text).toBe(expected);
        }
    });
    it('a «However» whose contrast is still there stays', () => {
        const reply = 'The Spark QA Plato costs 13,500 COP. However, preparation time is not recorded.';
        expect(guardDescriptionStatusClaim({ reply, sources: [DISH], lang: 'en' }).changed).toBe(false);
    });
});

describe('4. production QA 25-oct (image 57da6e58): «what is the hotel\'s address?» → the address sentence was removed', () => {
    const ROOM_AT = { rooms: [{ name: 'Spark QA Habitacion 20261018T113247Z', description: 'Habitación sintética para pruebas, no comercializable.',
        address: 'Direccion sintetica QA', city: 'Ciudad QA', maxGuests: 2, nightPrice: 150000 }] };
    it('a place field is said like a name: the address that holds «sintetica» stays', () => {
        const reply = 'The hotel is located at Direccion sintetica QA, in Ciudad QA. If you need more details or assistance, just let me know!';
        expect(guardDescriptionStatusClaim({ reply, sources: [ROOM_AT], lang: 'en' }).changed).toBe(false);
    });
    it('a claim about the room itself still goes', () => {
        const reply = 'The Spark QA Habitacion is a synthetic room for QA purposes. It is located at Direccion sintetica QA.';
        const out = guardDescriptionStatusClaim({ reply, sources: [ROOM_AT], lang: 'en' });
        expect(out.changed).toBe(true);
        expect(out.text).toContain('Direccion sintetica QA');
        expect(out.text).not.toMatch(/synthetic room/i);
    });
});
