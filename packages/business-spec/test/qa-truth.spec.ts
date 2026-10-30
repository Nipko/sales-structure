/** qaTruth (schema §10) y compose(perfil, subtipo). */
import { composeFor } from '../src/compose';
import { qaTruth } from '../src/qa/truth';
import { NOW, base, fixtureSnapshot, item, region, spec, val } from './helpers';

describe('qaTruth', () => {
    it('dato ausente → when_missing del requisito (C14 medios de pago en el dental: NC+AV)', () => {
        const t = qaTruth(spec, fixtureSnapshot('spark-qa-dental-03'), { intent: 'C14' });
        expect(t.expected).toBe('NC+AV');
        const methods = t.cases.find(c => c.requirementId === 'CORE.PAYMENT.METHODS');
        expect(methods).toMatchObject({ valueState: 'ausente', expected: 'NC+AV' });
        expect(methods?.never.join(' ')).toMatch(/negar un atributo/);
        expect(t.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('confirmado → AFIRMA con el valor; vacío confirmado → NIEGA', () => {
        const s = base('salud/dental');
        val(s, 'CORE.PAYMENT.METHODS', { methods: ['efectivo', 'tarjeta_débito'] });
        val(s, 'CORE.OFFER.PROMOTIONS', []);
        expect(qaTruth(spec, s, { requirementId: 'CORE.PAYMENT.METHODS' }, NOW).cases[0]).toMatchObject({ expected: 'AFIRMA', affirm: { methods: ['efectivo', 'tarjeta_débito'] } });
        expect(qaTruth(spec, s, { requirementId: 'CORE.OFFER.PROMOTIONS' }, NOW).expected).toBe('NIEGA');
    });

    it('precio de ejemplo de un ítem sembrado → no se afirma; a_cotizar → COTIZA; desde → AFIRMA con calificador', () => {
        const dental = fixtureSnapshot('spark-qa-dental-03');
        const seeded = dental.items.appointment[0];
        const t = qaTruth(spec, dental, { requirementId: 'OBJ.APPOINTMENT.CATALOG', itemId: seeded.id });
        expect(t.cases[0].expected).toBe('NC+AV');
        expect(t.cases[0].never.join(' ')).toMatch(/precio de ejemplo/);
        const s = base('salud/dental');
        item(s, 'appointment', { name: 'Implante' }, { priceType: 'a_cotizar', priceStatus: 'confirmed' });
        item(s, 'appointment', { name: 'Limpieza', price: 80000 }, { priceType: 'desde', priceStatus: 'confirmed' });
        expect(qaTruth(spec, s, { requirementId: 'OBJ.APPOINTMENT.CATALOG', itemId: 'appointment-1' }, NOW).cases[0].expected).toBe('COTIZA');
        expect(qaTruth(spec, s, { requirementId: 'OBJ.APPOINTMENT.CATALOG', itemId: 'appointment-2' }, NOW).cases[0]).toMatchObject({ expected: 'AFIRMA', qualifier: 'desde' });
    });

    it('contradictorio → when_missing y prohíbe los dos valores en conflicto', () => {
        const s = base('salud/dental');
        val(s, 'CORE.HOURS.REGULAR', { always_open: true }, { storage: 'settings.businessHours' });
        val(s, 'CORE.HOURS.REGULAR', { always_open: false, days: {} }, { storage: 'persona.hours' });
        const c = qaTruth(spec, s, { requirementId: 'CORE.HOURS.REGULAR' }, NOW).cases[0];
        expect(c).toMatchObject({ valueState: 'contradictorio', expected: 'NC+AV' });
        expect(c.never.filter(n => n.startsWith('el valor en conflicto'))).toHaveLength(2);
    });

    it('intención de cuenta → CUENTA; emergencia de salud → EXT; transversal sin requisito → CONVERSACIONAL', () => {
        const s = base('salud/dental');
        region(s);
        expect(qaTruth(spec, s, { intent: 'C19' }, NOW).expected).toBe('CUENTA');
        expect(qaTruth(spec, s, { intent: 'P08-7' }, NOW).expected).toBe('EXT');
        expect(qaTruth(spec, s, { intent: 'T02' }, NOW).expected).toBe('CONVERSACIONAL');
    });

    it('requisito que no aplica al tenant → N/A (no genera casos)', () => {
        const t = qaTruth(spec, fixtureSnapshot('spark-qa-comida-04'), { requirementId: 'CORE.POLICY.WARRANTY' });
        expect(t).toMatchObject({ expected: 'N/A', cases: [{ applies: false }] });
    });
});

describe('compose(perfil, subtipo)', () => {
    it('comida rápida: núcleo + food_order(delivery) con SERVICE_AREA y DELIVERY.TERMS bloqueantes; sin WARRANTY ni CANCELLATION', () => {
        const set = composeFor(spec, { subtype: 'restaurantes/comida_rapida' });
        const byId = new Map(set.map(e => [e.req.id, e]));
        expect(byId.get('CORE.SERVICE_AREA')?.level).toBe('bloqueante');
        expect(byId.get('CORE.DELIVERY.TERMS')?.level).toBe('bloqueante');
        expect(byId.has('OBJ.FOOD_ORDER.ALLERGENS_DIET')).toBe(true);
        expect(byId.has('CORE.POLICY.WARRANTY')).toBe(false);
        expect(byId.has('CORE.POLICY.CANCELLATION_CHANGES')).toBe(false);
        expect(set).toHaveLength(56);
    });

    it('agencia de viajes: CANCELLATION sube a bloqueante por override de P06 aunque todo sea solicitud', () => {
        const e = composeFor(spec, { subtype: 'turismo/agencia_viajes' }).find(x => x.req.id === 'CORE.POLICY.CANCELLATION_CHANGES');
        expect(e).toMatchObject({ level: 'bloqueante', rule: 'R2' });
        expect(e?.reasons).toEqual(['base', 'when: not any_reservable_direct', 'override profile:P06']);
    });

    it('hotel: CANCELLATION es necesaria (solo solicitudes) y OFFER.FEES bloqueante por el objeto', () => {
        const set = composeFor(spec, { subtype: 'turismo/hotel' });
        expect(set.find(x => x.req.id === 'CORE.POLICY.CANCELLATION_CHANGES')).toMatchObject({ level: 'necesario', rule: 'R4' });
        expect(set.find(x => x.req.id === 'CORE.OFFER.FEES')).toMatchObject({ level: 'bloqueante', rule: 'R2' });
    });
});
