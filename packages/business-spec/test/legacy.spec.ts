/** Reglas L1–L7 (schema §7.5), expresiones de applies_when y hash puro. */
import { createHash } from 'node:crypto';
import { evalExpr, parseExpr, validateExpr } from '../src/expr';
import { canonicalJson, sha256 } from '../src/hash';
import { factRows } from '../src/business-facts';
import { COLUMN_DEFAULTS, fromLegacyRows, normalizeHours, rowStatus, unconfirmedColumnDefaults } from '../src/legacy-status';
import { evaluate } from '../src/engine/evaluate';
import { itemFieldState } from '../src/qa/truth';
import { NOW, base, fixtureSnapshot, item, spec } from './helpers';

describe('reglas L de datos heredados', () => {
    const ctx = { windowStart: Date.parse('2026-10-18T09:22:30Z'), windowEnd: Date.parse('2026-10-18T09:22:35Z') };

    it('L3: creada en la ventana de aprovisionamiento y nunca editada → sembrada; si no, L6 confirmada', () => {
        expect(rowStatus({ created_at: '2026-10-18 09:22:34.1', updated_at: '2026-10-18 09:22:34.1' }, ctx)).toEqual({ status: 'seeded', rule: 'L3' });
        expect(rowStatus({ created_at: '2026-10-18 09:22:34.1', updated_at: '2026-10-19 10:00:00' }, ctx)).toEqual({ status: 'confirmed', rule: 'L6' });
        expect(rowStatus({ created_at: '2026-10-18 11:08:00', updated_at: '2026-10-18 11:08:00' }, ctx)).toEqual({ status: 'confirmed', rule: 'L6' });
    });

    it('L1: price_status example → ejemplo; L3: servicios del alta sembrados (dental)', () => {
        const svc = fixtureSnapshot('spark-qa-dental-03').items.appointment;
        expect(svc).toHaveLength(3);
        expect(svc.every(s => s.contentStatus === 'seeded' && s.priceStatus === 'example')).toBe(true);
    });

    it('L6 + L7: plato creado después del alta con precio > 0 → confirmado con price_type fijo inferido; L4: allergens [] no es vacío confirmado', () => {
        const [plate] = fixtureSnapshot('spark-qa-comida-04').items.food_order;
        expect(plate).toMatchObject({ contentStatus: 'confirmed', priceType: 'fijo', priceStatus: 'confirmed', legacyRule: 'L7', origin: 'legacy_inferred' });
        expect(plate.fieldStatus?.allergens).toBe('seeded');
    });

    it('L2: nombre y subtipo del alta → confirmados (onboarding); L5: configuración de persona de plantilla → sembrada', () => {
        const snap = fixtureSnapshot('spark-qa-dental-03');
        expect(snap.values['CORE.IDENTITY.NAME'][0]).toMatchObject({ status: 'confirmed', origin: 'onboarding', legacyRule: 'L2' });
        expect(snap.values['CORE.HANDOFF.ALWAYS_HUMAN'][0]).toMatchObject({ status: 'seeded', legacyRule: 'L5' });
        expect(snap.values['CORE.IDENTITY.REGION']).toBeUndefined(); // regional_provenance vacío ⇒ ausente
    });

    it('normaliza los formatos de horario que conviven hoy', () => {
        expect(normalizeHours({ schedule: {} })).toBeNull();
        expect(normalizeHours({ is247: true })).toMatchObject({ always_open: true });
        expect(normalizeHours({ schedule: { monday: { enabled: true, open: '08:00', close: '18:00' }, sunday: { enabled: false, open: '', close: '' } } }))
            .toEqual({ always_open: false, timezone: null, days: { mon: [{ open: '08:00', close: '18:00' }], sun: [] } });
        expect(normalizeHours({ schedule: { mon: '09:00-13:00, 14:00-18:00' } })?.days.mon).toHaveLength(2);
    });
});

describe('ficha de alojamiento', () => {
    it('E2l: lleva dormitorios, baños y dirección de la unidad, que el agente lee', () => {
        const rows = factRows({ tenant: { ref: 't', name: 'Hotel', settings: {} }, companies: [], policies: [], requirement_values: [] });
        rows.properties = [{ id: 'p1', name: 'Doble', description: null, address: 'Calle 1', city: 'Ciudad', max_guests: 2, bedrooms: 1, bathrooms: 1,
            night_price: 150000, min_nights: 1, amenities: [], is_active: true, created_at: '2026-10-20 10:00:00', updated_at: '2026-10-21 10:00:00' }];
        const [unit] = fromLegacyRows(rows).items.lodging_booking;
        expect(unit.fields).toMatchObject({ bedrooms: 1, bathrooms: 1, address: 'Calle 1', city: 'Ciudad', price_per_night: 150000 });
    });
});

describe('ficha de tour', () => {
    it('E2m: lleva el mínimo y el máximo de viajeros del paquete, que el agente lee', () => {
        const rows = factRows({ tenant: { ref: 't', name: 'Agencia', settings: {} }, companies: [], policies: [], requirement_values: [] });
        rows.tour_packages = [{ id: 'k1', name: 'Tour', destination: 'X', duration_type: 'hours', duration_value: 4, min_party_size: 2, max_capacity: 12,
            price: 125, currency: 'EUR', is_active: true, created_at: '2026-10-20 10:00:00', updated_at: '2026-10-21 10:00:00' }];
        const [tour] = fromLegacyRows(rows).items.tour_booking;
        expect(tour.fields).toMatchObject({ min_group: 2, max_group: 12, currency: 'EUR' });
        expect(tour.fieldStatus).toMatchObject({ min_group: 'confirmed', max_group: 'confirmed' });
    });
});

describe('opción B (dueño, 2026-11-06): el default de columna no es dato del negocio hasta que se confirma', () => {
    const tenant = { tenant: { ref: 't', name: 'Negocio', settings: {} }, companies: [], policies: [], requirement_values: [] };
    const edited = { is_active: true, created_at: '2026-10-20 10:00:00', updated_at: '2026-10-21 10:00:00' };

    it('tour con 1 y 10 sin confirmar → mínimo y máximo sembrados (L4); el formulario guardado los confirma aunque sean iguales', () => {
        const rows = factRows(tenant);
        rows.tour_packages = [
            { id: 'k1', name: 'Tour Uno', destination: 'X', min_party_size: 1, max_capacity: 10, price: 125, ...edited },
            { id: 'k2', name: 'Tour Dos', destination: 'X', min_party_size: 1, max_capacity: 10, price: 125, ...edited,
                metadata: { confirmed_fields: { max_capacity: '2026-11-06T10:00:00Z', min_party_size: '2026-11-06T10:00:00Z' } } },
            { id: 'k3', name: 'Tour Tres', destination: 'X', min_party_size: 1, max_capacity: 8, price: 125, ...edited, confirmed_fields: { min_party_size: '2026-11-06T10:00:00Z' } },
        ];
        const [uno, dos, tres] = fromLegacyRows(rows).items.tour_booking;
        expect(uno.fields).toMatchObject({ min_group: 1, max_group: 10 });
        expect(uno.fieldStatus).toMatchObject({ min_group: 'seeded', max_group: 'seeded' });
        expect(dos.fieldStatus).toMatchObject({ min_group: 'confirmed', max_group: 'confirmed' });
        // la columna `confirmed_fields` que proyecta el lector de la foto cuenta igual que metadata.confirmed_fields
        expect(tres.fieldStatus).toMatchObject({ min_group: 'confirmed', max_group: 'confirmed' });
        expect(unconfirmedColumnDefaults('tour_packages', rows.tour_packages[0])).toEqual(['min_party_size', 'max_capacity']);
        // la verdad QA no los afirma: «no consta» + AV
        expect(itemFieldState(uno, 'max_group')).toBe('sembrado');
        expect(itemFieldState(dos, 'max_group')).toBe('confirmado');
    });

    it('alojamiento con limpieza 0 sin confirmar → sembrada; un 0 confirmado o una tarifa > 0 → confirmada', () => {
        const rows = factRows(tenant);
        const unit = { name: 'Doble', max_guests: 2, bedrooms: 1, night_price: 150000, min_nights: 1, amenities: [], ...edited };
        rows.properties = [
            { ...unit, id: 'p1', cleaning_fee: 0 },
            { ...unit, id: 'p2', cleaning_fee: '0.00', metadata: { confirmed_fields: { cleaning_fee: '2026-11-06T10:00:00Z' } } },
            { ...unit, id: 'p3', cleaning_fee: 30000 },
        ];
        const [p1, p2, p3] = fromLegacyRows(rows).items.lodging_booking;
        expect(p1.fields.cleaning_fee).toBe(0);
        expect(p1.fieldStatus?.cleaning_fee).toBe('seeded');
        expect(p2.fieldStatus?.cleaning_fee).toBe('confirmed');
        expect(p3.fieldStatus?.cleaning_fee).toBe('confirmed');
        expect(COLUMN_DEFAULTS.properties).toEqual({ cleaning_fee: 0 });
    });

    it('la preparación pregunta por cada ítem confirmado, nombrándolo; no bloquea el catálogo', () => {
        const s = base('turismo/agencia_viajes');
        item(s, 'tour_booking', { name: 'Tour Aurora', destination: 'X', min_group: 1, max_group: 10 }, { fieldStatus: { min_group: 'seeded', max_group: 'seeded' } });
        item(s, 'tour_booking', { name: 'Tour Boreal', destination: 'X', min_group: 2, max_group: 12 });
        const result = evaluate(spec, s, NOW);
        const messages = result.qualityWarnings.filter(w => w.id === 'OBJ.TOUR_BOOKING.CATALOG').map(w => w.message);
        expect(messages).toEqual([
            expect.stringContaining('¿Cuál es el mínimo de viajeros del tour «Tour Aurora»?'),
            expect.stringContaining('¿Cuál es el máximo de viajeros del tour «Tour Aurora»?'),
        ]);
        const s2 = base('turismo/hotel');
        item(s2, 'lodging_booking', { unit_name: 'Suite Mar', cleaning_fee: 0 }, { fieldStatus: { cleaning_fee: 'seeded' } });
        const hotel = evaluate(spec, s2, NOW).qualityWarnings.filter(w => w.id === 'OBJ.LODGING_BOOKING.CATALOG').map(w => w.message);
        expect(hotel).toEqual([expect.stringContaining('¿Cobras tarifa de limpieza en «Suite Mar»?')]);
    });
});

describe('expresiones de applies_when', () => {
    const env = {
        objectEnabled: (o: string) => o === 'service_request', variant: () => 'repair_order', writeMode: () => 'request_to_business' as const,
        paymentRequired: () => false, availabilityKinds: () => ['recurso'], enabledObjects: ['service_request'], reservableObjects: new Set<string>(),
        profileId: 'P27', domains: new Set(['home_safety']), modality: null, deliveryOffered: false, sellsGoods: false, hasPrepayment: false,
        hoursAlwaysOpen: false, staffCount: 2, estimateRequired: false, booksByStaff: false, subtype: 'taller', object: 'service_request',
    };
    it.each([
        ['object_enabled(service_request) and variant ∈ [home_service, repair_order]', true],
        ['object_enabled(service_request) and (variant = repair_order or estimate_required)', true],
        ['profile_in([P09, P08, P17])', false],
        ['modality_includes(presencial)', true], // modalidad desconocida ⇒ aplica (falla segura)
        ['not hours_always_open', true],
        ['object_enabled(appointment) and staff_count > 1', false],
        ['domain(home_safety) and subtype = cerrajeria', false],
        ['availability_kinds(service_request) ≠ []', true],
    ])('%s → %s', (src, expected) => {
        expect(evalExpr(parseExpr(src), env)).toBe(expected);
    });

    it('un átomo o un objeto desconocido es un defecto', () => {
        const known = { objects: new Set(['appointment']), domains: new Set(['health']), profiles: new Set(['P08']) };
        expect(validateExpr(parseExpr('tiene_moto'), known)).toEqual(['átomo desconocido «tiene_moto»']);
        expect(validateExpr(parseExpr('object_enabled(barco)'), known)).toEqual(['objeto desconocido «barco» en «object_enabled»']);
        expect(() => parseExpr('object_enabled(appointment')).toThrow();
    });
});

describe('hash', () => {
    it('sha256 puro coincide con node:crypto y el JSON canónico no depende del orden de claves', () => {
        for (const s of ['', 'abc', 'Clínica Sonrisa ñ 🦷', 'x'.repeat(1000)]) expect(sha256(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
        expect(canonicalJson({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe(canonicalJson({ a: [2, { d: 3 }], b: 1 }));
    });
});
