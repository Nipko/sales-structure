import { complaintIsOfferOnly, isProductDefectReport, isSafetyCriticalContext } from './handoff-policy-question';

/**
 * A report of a defective product is answered and a person is offered (production 2026-10-10, Tienda QA Electrónica) — but only a plain
 * product complaint. A defect that can hurt someone, or that a person must judge, goes to a person at once (PR #85 review): gas, heat,
 * brakes, an airbag, a swallowed piece, a reaction, pain, a medicine, a medical device, a child; and every defect report in a health,
 * veterinary or vehicle business.
 */
const SHOP = { industry: 'retail' };

describe('a plain product complaint is answered and a person offered', () => {
    it.each([
        'quiero pedir perdón, el Audífono QA Aurora llegó roto', 'el audífono no funciona', 'la nevera no enfría, se dañó', 'la camiseta llegó rota',
        'el teclado llegó dañado', 'the keyboard arrived broken', 'le clavier est arrivé cassé', 'o fone chegou quebrado',
    ])('«%s»', text => {
        expect(isProductDefectReport(text)).toBe(true);
        expect(complaintIsOfferOnly('complaint', text, [], SHOP)).toBe(true);
    });
});

describe('a defect that can hurt someone, or that a person must judge, is never offer-only (any business)', () => {
    it.each([
        // gas, heat, fire, electricity
        'el calentador no funciona y huele a gas', 'hay olor a gas, el calentador llegó dañado', 'la estufa llegó rota y tiene una fuga',
        'el cargador se recalienta mucho y no funciona', 'la plancha se sobrecalienta y no funciona', 'el cargador sacó chispas y no funciona',
        'el ventilador echa humo, llegó dañado', 'el cargador llegó roto y me dio una descarga', 'the charger overheats and does not work',
        'le chargeur surchauffe et ne fonctionne pas', 'o aquecedor chegou quebrado e tem cheiro de gás', 'there is a gas leak, the heater is broken',
        // vehicles
        'el airbag no funciona', 'los frenos no funcionan', 'the brakes do not work', 'les freins ne fonctionnent pas', 'a direção hidráulica não funciona',
        // the body, children
        'mi hijo se tragó una pieza, el juguete llegó roto', 'el bebé se atragantó, el biberón llegó dañado', 'my child swallowed a piece, the toy arrived broken',
        'la crema me causó reacción y no funciona', 'me salieron ronchas, el producto llegó dañado', 'me dio alergia, el producto llegó roto',
        'me dio dolor de cabeza el medicamento que llegó dañado', 'me mareo con el aparato que llegó roto', 'the pills arrived damaged and I felt sick',
        'la pastilla llegó rota', 'o remédio chegou danificado', 'le médicament est arrivé endommagé', 'me dio fiebre, el producto llegó dañado',
        // medical devices
        'el tensiómetro no funciona', 'el glucómetro llegó roto', 'el termómetro no funciona', 'el nebulizador llegó dañado', 'the pulse oximeter does not work',
    ])('«%s»', text => {
        expect(complaintIsOfferOnly('complaint', text, [], SHOP)).toBe(false);
    });
});

describe('what stays automatic whatever the words', () => {
    it('a grievance, a refund, a return and an exchange', () => {
        for (const text of ['llegó roto, esto es una estafa', 'el producto llegó dañado, quiero que me devuelvan la plata', 'el producto llegó roto, quiero cambiarlo', 'quiero poner una queja, llegó roto']) {
            expect(complaintIsOfferOnly('complaint', text, [], SHOP)).toBe(false);
        }
    });

    it('any other reason than a complaint, and a trigger the owner wrote', () => {
        expect(complaintIsOfferOnly('human_request', 'el audífono llegó roto', [], SHOP)).toBe(false);
        expect(complaintIsOfferOnly('complaint', 'el audífono llegó roto, quiero usar la garantía', ['garantia'], SHOP)).toBe(false);
        expect(complaintIsOfferOnly('complaint', 'el audífono llegó roto', ['garantia'], SHOP)).toBe(true);
    });

    it.each(['salud', 'veterinaria', 'automotriz', 'health', 'Salud'])('in a «%s» business a plain defect report is not offer-only', industry => {
        expect(complaintIsOfferOnly('complaint', 'el audífono llegó roto', [], { industry })).toBe(false);
    });

    it.each(['farmacia', 'clínica dental', 'taller mecánico', 'óptica', 'concesionario', 'ortopédicos', 'clinica_veterinaria'])('and neither in a «%s» (sub-type)', subType => {
        expect(complaintIsOfferOnly('complaint', 'el audífono llegó roto', [], { industry: 'retail', subType })).toBe(false);
    });

    it.each(['retail', 'moda_belleza', 'restaurantes', 'technology', undefined])('a shop (%s) keeps the offer', industry => {
        expect(isSafetyCriticalContext(industry, 'moda')).toBe(false);
        expect(complaintIsOfferOnly('complaint', 'el audífono llegó roto', [], { industry, subType: 'moda' })).toBe(true);
    });
});
