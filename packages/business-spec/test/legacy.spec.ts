/** Reglas L1–L7 (schema §7.5), expresiones de applies_when y hash puro. */
import { createHash } from 'node:crypto';
import { evalExpr, parseExpr, validateExpr } from '../src/expr';
import { canonicalJson, sha256 } from '../src/hash';
import { normalizeHours, rowStatus } from '../src/legacy-status';
import { fixtureSnapshot } from './helpers';

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
