/**
 * R1.1: qaTruth alcanza su objetivo de aceptación (R1-medicion-qatruth.md, arreglos F1–F7 y F10).
 * Cada bloque prueba un arreglo sobre las fotos golden de los tenants QA y sobre fotos mínimas.
 */
import { evaluate } from '../src/engine/evaluate';
import { fromLegacyRows, hoursFromAgenda, inferCovers } from '../src/legacy-status';
import { itemFieldState, qaTruth, requirementsForIntent } from '../src/qa/truth';
import { NOW, base, fixtureRows, fixtureSnapshot, item, spec } from './helpers';

const LISTING = '57542cc7-de10-4166-b731-704bc7fa403d';
const AURORA_EARBUD = '09cddfe4-1421-4ad8-82dd-a252d45fe0ac';
const SPARK_TOUR = '76775f40-2fdd-48e2-9db5-c6afa93573dc';
const AURORA_TOUR = '847fdf5f-49ff-4b8f-8c3d-f13baaf651b5';

describe('F1 · CORE.HOURS.REGULAR desde la agenda', () => {
    it('la agenda es una grilla semanal: días sin franja = cerrado, franjas de varios profesionales unidas', () => {
        const h = hoursFromAgenda([
            { day_of_week: 1, start_time: '08:00:00', end_time: '12:00:00' }, { day_of_week: 1, start_time: '11:00:00', end_time: '18:00:00' },
            { day_of_week: 6, start_time: '08:00:00', end_time: '13:00:00' }, { day_of_week: 2, start_time: '09:00:00', end_time: '10:00:00', is_active: false },
        ]);
        expect(h?.days).toEqual({ sun: [], mon: [{ open: '08:00', close: '18:00' }], tue: [], wed: [], thu: [], fri: [], sat: [{ open: '08:00', close: '13:00' }] });
        expect(hoursFromAgenda([])).toBeNull();
    });

    it('agenda sembrada por la plantilla del alta (dental) → sembrada (L3): NC+AV y prohíbe el horario de plantilla como hecho', () => {
        const dental = fixtureSnapshot('spark-qa-dental-03');
        const rec = dental.values['CORE.HOURS.REGULAR'];
        expect(rec).toHaveLength(1);
        expect(rec[0]).toMatchObject({ status: 'seeded', legacyRule: 'L3', storage: 'availability_slots (agenda; horario informativo)' });
        expect((rec[0].value as { days: Record<string, unknown> }).days.fri).toEqual([{ open: '08:00', close: '18:00' }]);
        const c = qaTruth(spec, dental, { requirementId: 'CORE.HOURS.REGULAR' }).cases[0];
        expect(c).toMatchObject({ valueState: 'sembrado', expected: 'NC+AV' });
        expect(c.never.join(' ')).toMatch(/sembrado como hecho \(availability_slots.*08:00/);
    });

    it('agenda cargada después del alta → confirmada (L6): AFIRMA el horario; el horario del negocio tiene precedencia', () => {
        const rows = fixtureRows('salon-qa-citas');
        rows.availability_slots = rows.availability_slots.map(s => ({ ...s, created_at: '2026-10-20T10:00:00' }));
        const c = qaTruth(spec, fromLegacyRows(rows), { requirementId: 'CORE.HOURS.REGULAR' }).cases[0];
        expect(c).toMatchObject({ valueState: 'confirmado', expected: 'AFIRMA' });
        expect((c.affirm as { days: Record<string, unknown> }).days.sat).toEqual([{ open: '09:00', close: '19:00' }]);
        rows.tenant.settings = { ...rows.tenant.settings, businessHours: { schedule: { monday: '10:00-14:00' } } };
        expect(fromLegacyRows(rows).values['CORE.HOURS.REGULAR'].map(r => r.storage)).toEqual(['settings.businessHours']);
    });
});

describe('F2 · garantía y devoluciones con evidencia de texto (covers)', () => {
    it('covers se infiere del título de la FAQ', () => {
        expect(inferCovers('¿Cuál es el plazo de garantía QA del audífono?')).toEqual(['CORE.POLICY.WARRANTY']);
        expect(inferCovers('¿Aceptan devoluciones?')).toEqual(['CORE.POLICY.REFUND_RETURNS']);
        expect(inferCovers('What is your refund policy?')).toEqual(['CORE.POLICY.REFUND_RETURNS']);
        expect(inferCovers('¿Qué horario tienen?')).toEqual([]);
    });

    it('FAQ confirmada (L6) de garantía en la tienda → la garantía cumple y qaTruth AFIRMA el texto', () => {
        const tienda = fixtureSnapshot('tienda-qa-electronica');
        expect(evaluate(spec, tienda).requirements.find(r => r.id === 'CORE.POLICY.WARRANTY')).toMatchObject({ result: 'cumple', detail: expect.stringMatching(/texto confirmado/) });
        const c = qaTruth(spec, tienda, { requirementId: 'CORE.POLICY.WARRANTY' }).cases[0];
        expect(c).toMatchObject({ expected: 'AFIRMA', valueState: 'confirmado', evidence: { kind: 'texto' } });
        expect(String((c.affirm as { text: string }).text)).toMatch(/72 días/);
    });

    it('una FAQ sembrada (D5) no es evidencia: sigue NC+AV', () => {
        const rows = fixtureRows('tienda-qa-electronica');
        const tienda = fromLegacyRows(rows);
        tienda.texts = tienda.texts.map(t => (t.covers?.includes('CORE.POLICY.WARRANTY') ? { ...t, status: 'seeded' as const } : t));
        expect(qaTruth(spec, tienda, { requirementId: 'CORE.POLICY.WARRANTY' }).cases[0]).toMatchObject({ expected: 'NC+AV' });
    });
});

describe('F3 · inmobiliaria: dirección y financiación del listado', () => {
    it('afirma la dirección del listado (address_privacy sin declarar = publica)', () => {
        const c = qaTruth(spec, fixtureSnapshot('inmobiliaria-qa'), { requirementId: 'OBJ.REAL_ESTATE.CATALOG', itemId: LISTING }).cases[0];
        expect(c.affirm).toMatchObject({ address: 'Calle Sintetica QA 123', bedrooms: 2 });
    });

    it('con address_privacy ≠ publica la dirección no se afirma y se dice que se comparte al confirmar', () => {
        const rows = fixtureRows('inmobiliaria-qa');
        rows.real_estate_listings = rows.real_estate_listings.map(l => ({ ...l, address_privacy: 'tras_confirmar' }));
        const c = qaTruth(spec, fromLegacyRows(rows), { requirementId: 'OBJ.REAL_ESTATE.CATALOG', itemId: LISTING }).cases[0];
        expect(c.affirm).not.toHaveProperty('address');
        expect(c.behavior).toMatch(/se comparte al confirmar/);
    });

    it('financing_available = false es el default de la columna (L4): NC+AV; true → AFIRMA por listado', () => {
        const rows = fixtureRows('inmobiliaria-qa');
        const q = { requirementId: 'CORE.PAYMENT.FINANCING', itemId: LISTING };
        expect(qaTruth(spec, fromLegacyRows(rows), q).cases[0]).toMatchObject({ expected: 'NC+AV', valueState: 'sembrado' });
        rows.real_estate_listings = rows.real_estate_listings.map(l => ({ ...l, financing_available: true }));
        expect(qaTruth(spec, fromLegacyRows(rows), q).cases[0]).toMatchObject({ expected: 'AFIRMA', affirm: { installments: { enabled: true } } });
    });
});

describe('F4 · stock e idiomas del tour; salidas cargadas', () => {
    it('stock del producto e idiomas del guía en la ficha', () => {
        expect(qaTruth(spec, fixtureSnapshot('tienda-qa-electronica'), { requirementId: 'OBJ.CATALOG_ORDER.CATALOG', itemId: AURORA_EARBUD }).cases[0].affirm).toMatchObject({ stock: 2 });
        expect(qaTruth(spec, fixtureSnapshot('agencia-qa-viajes'), { requirementId: 'OBJ.TOUR_BOOKING.CATALOG', itemId: SPARK_TOUR }).cases[0].affirm).toMatchObject({ guide_languages: ['es'] });
    });

    it('disponibilidad por ítem: afirma las salidas cargadas; sin salidas → when_missing', () => {
        const agencia = fixtureSnapshot('agencia-qa-viajes');
        expect(qaTruth(spec, agencia, { requirementId: 'OBJ.TOUR_BOOKING.AVAILABILITY_SOURCE', itemId: SPARK_TOUR }).cases[0])
            .toMatchObject({ expected: 'AFIRMA', affirm: { departures: [{ date: '2026-12-15', seats_left: 10 }] } });
        expect(qaTruth(spec, agencia, { requirementId: 'OBJ.TOUR_BOOKING.AVAILABILITY_SOURCE', itemId: AURORA_TOUR }).cases[0].expected).toBe('NC+AV');
    });
});

describe('F5 · campos que pide la reserva (services.required_fields)', () => {
    it('CUSTOMER_REQUIREMENTS sin dato + servicio: AFIRMA exactamente required_fields (when_missing: «usa WRITE_MODE.required_fields»)', () => {
        const dental = fixtureSnapshot('spark-qa-dental-03');
        const c = qaTruth(spec, dental, { requirementId: 'OBJ.APPOINTMENT.CUSTOMER_REQUIREMENTS', itemId: dental.items.appointment[0].id }).cases[0];
        expect(c).toMatchObject({ expected: 'AFIRMA', valueState: 'ausente', affirm: { required_fields: ['name', 'phone'] } });
        expect(c.never.join(' ')).toMatch(/omitir alguno/);
        // sin ítem no hay campos del motor que leer: when_missing
        expect(qaTruth(spec, dental, { requirementId: 'OBJ.APPOINTMENT.CUSTOMER_REQUIREMENTS' }).expected).toBe('NC+AV');
    });
});

describe('F6 + F7 · estado por campo del ítem', () => {
    it('F6: servicio sembrado con price_status=example → solo el precio queda por confirmar; la duración se afirma', () => {
        const dental = fixtureSnapshot('spark-qa-dental-03');
        const general = dental.items.appointment.find(i => i.fields.name === 'Consulta general');
        expect(general).toMatchObject({ contentStatus: 'seeded', priceStatus: 'example', priceMarker: true });
        const c = qaTruth(spec, dental, { requirementId: 'OBJ.APPOINTMENT.CATALOG', itemId: general?.id }).cases[0];
        expect(c).toMatchObject({ expected: 'AFIRMA', affirm: { duration: { min: 30, unit: 'min' } } });
        expect(c.fields).toMatchObject({ price: 'ejemplo', currency: 'ejemplo', duration: 'confirmado' });
        expect(c.behavior).toMatch(/por confirmar/);
        // la preparación no cambia: el servicio sigue siendo de la plantilla del alta
        expect(evaluate(spec, dental).requirements.find(r => r.id === 'OBJ.APPOINTMENT.CATALOG')?.result).toBe('no_cumple');
    });

    it('F6: sin marcador explícito, un ítem sembrado sigue entero «por confirmar»', () => {
        const s = base('salud/dental');
        item(s, 'appointment', { name: 'Limpieza', duration: { min: 40, unit: 'min' } }, { contentStatus: 'seeded', legacyRule: 'L3' });
        expect(qaTruth(spec, s, { requirementId: 'OBJ.APPOINTMENT.CATALOG', itemId: 'appointment-1' }, NOW).cases[0]).toMatchObject({ expected: 'NC+AV', valueState: 'sembrado' });
    });

    it('F7: lista vacía por defecto (includes []) → «no consta», nunca en affirm (no habilita «no incluye»)', () => {
        const agencia = fixtureSnapshot('agencia-qa-viajes');
        const tour = agencia.items.tour_booking.find(i => i.id === SPARK_TOUR);
        expect(tour && itemFieldState(tour, 'includes')).toBe('ausente');
        const c = qaTruth(spec, agencia, { requirementId: 'OBJ.TOUR_BOOKING.CATALOG', itemId: SPARK_TOUR }).cases[0];
        expect(c.affirm).not.toHaveProperty('includes');
        expect(c.unknown).toEqual(expect.arrayContaining(['includes', 'excludes', 'meeting_point']));
        expect(c.behavior).toMatch(/nunca «no»/);
    });

    it('F7: lista vacía confirmada campo a campo sí es un vacío confirmado', () => {
        const s = base('turismo/agencia_viajes');
        item(s, 'tour_booking', { name: 'Tour', includes: [] }, { legacyRule: 'L6', fieldStatus: { includes: 'confirmed' } });
        expect(qaTruth(spec, s, { requirementId: 'OBJ.TOUR_BOOKING.CATALOG', itemId: 'tour_booking-1' }, NOW).cases[0].affirm).toMatchObject({ includes: [] });
    });
});

describe('F10 · consulta por requisito + ítem, nunca solo por intención', () => {
    it('una intención no conversacional sin requisito es un error; requirementsForIntent da los candidatos', () => {
        const dental = fixtureSnapshot('spark-qa-dental-03');
        expect(() => qaTruth(spec, dental, { intent: 'C03' })).toThrow(/por requisito/);
        expect(requirementsForIntent(spec, dental, 'C03')).toEqual(expect.arrayContaining(['CORE.HOURS.REGULAR']));
        expect(qaTruth(spec, dental, { intent: 'T02' }).expected).toBe('CONVERSACIONAL');
    });

    it('el requisito tiene que responder la intención indicada', () => {
        expect(() => qaTruth(spec, fixtureSnapshot('spark-qa-dental-03'), { intent: 'C03', requirementId: 'CORE.PAYMENT.METHODS' })).toThrow(/no responde/);
    });

    it('un ítem no convierte cualquier requisito de su objeto en la ficha del catálogo (antes AVAILABILITY_SOURCE devolvía la ficha)', () => {
        const agencia = fixtureSnapshot('agencia-qa-viajes');
        const c = qaTruth(spec, agencia, { requirementId: 'OBJ.TOUR_BOOKING.CHANGE_RULES', itemId: SPARK_TOUR }).cases[0];
        expect(c.affirm).toBeUndefined();
        expect(c.expected).not.toBe('AFIRMA');
        expect(() => qaTruth(spec, agencia, { requirementId: 'OBJ.TOUR_BOOKING.CATALOG', itemId: 'no-existe' })).toThrow(/ítem desconocido/);
    });

    it('cada consulta devuelve un solo caso: el del requisito pedido', () => {
        const t = qaTruth(spec, fixtureSnapshot('agencia-qa-viajes'), { requirementId: 'OBJ.TOUR_BOOKING.AVAILABILITY_SOURCE', itemId: SPARK_TOUR });
        expect(t.cases.map(c => c.requirementId)).toEqual(['OBJ.TOUR_BOOKING.AVAILABILITY_SOURCE']);
        expect(t.expected).toBe(t.cases[0].expected);
    });
});
