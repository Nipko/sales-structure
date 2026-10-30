/**
 * Aceptación R1 #3: cada uno de los 95 requisitos de la especificación tiene una foto que cumple y una que no.
 * Los genéricos se arman desde `predicate_params`; los `custom`, desde la tabla CUSTOM de abajo.
 * Las plantillas OBJ.* se prueban instanciadas en OBJ.APPOINTMENT.* (tenant dental).
 */
import type { TenantSnapshot } from '../src/types';
import { NOW, admin, base, evalReq, item, region, spec, val } from './helpers';

const DAY = 86_400_000;
const days = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();
const WEEK = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, d === 'sun' ? [] : [{ open: '08:00', close: '18:00' }]]));
const WRITE_OK = { mode: 'request_to_business', required_fields: ['nombre', 'telefono'], confirmation_terms: ['servicio', 'fecha'], business_confirm_sla: { min: 2, unit: 'h' }, consent_required: true };

/** Subtipo con el que el requisito aplica (por defecto, el dental: P08 · appointment · health). */
const SUBTYPE: Record<string, string> = {
    'CORE.SERVICE_AREA': 'restaurantes/comida_rapida', 'CORE.DELIVERY.TERMS': 'restaurantes/comida_rapida',
    'CORE.POLICY.REFUND_RETURNS': 'restaurantes/comida_rapida', 'CORE.POLICY.WARRANTY': 'retail/electronica',
    'CORE.POLICY.HOUSE_RULES': 'restaurantes/casual_dining', 'CORE.PROC.OFFER_ACCEPTANCE': 'otro/__none__',
    'OBJ.FOOD_ORDER.ALLERGENS_DIET': 'restaurantes/comida_rapida', 'OBJ.FOOD_ORDER.MODIFIERS': 'restaurantes/comida_rapida',
    'OBJ.LODGING_BOOKING.CHECKIN_RULES': 'turismo/hotel', 'OBJ.REAL_ESTATE.COSTS': 'inmobiliaria/venta',
    'OBJ.SERVICE_REQUEST.EMERGENCY_SERVICE': 'automotriz/taller', 'OBJ.SERVICE_REQUEST.ESTIMATE_APPROVAL': 'automotriz/taller',
    'OBJ.RENTAL.DAMAGE_INSURANCE': 'automotriz/alquiler', 'OBJ.PET_BOARDING.CARE_RULES': 'pet_services/hotel',
    'OBJ.PHOTO_SESSION.RIGHTS_DELIVERY': 'fotografia/bodas',
    'PROF.P01.TABLE_RULES': 'restaurantes/casual_dining', 'PROF.P01.EVENTS_GROUPS': 'restaurantes/casual_dining',
    'PROF.P03.HOLD_SPECIAL_ORDER': 'retail/electronica', 'PROF.P05.NEARBY': 'turismo/hotel', 'PROF.P06.TRAVEL_DOCS': 'turismo/tours',
    'PROF.P07.FAIR_HOUSING': 'inmobiliaria/venta', 'PROF.P12.CONTRAINDICATIONS_AFTERCARE': 'moda_belleza/spa',
    'PROF.P14.ATTENDANCE_POLICIES': 'education/idiomas', 'PROF.P15.ADMISSIONS_CALENDAR': 'education/universitaria',
    'PROF.P23.PRICING_PORTFOLIO': 'servicios_profesionales/consultores', 'PROF.P24.SELF_SERVICE': 'technology/saas',
    'PROF.P26.TRADE_IN': 'automotriz/concesionario',
    'DOM.MENTAL_HEALTH.CRISIS_PROTOCOL': 'salud/psicologia', 'DOM.PHARMACY.PRESCRIPTION': 'salud/farmacia',
    'DOM.VETERINARY.EMERGENCY': 'veterinaria/clinica_general', 'DOM.INSURANCE.LICENSE_DISCLAIMER': 'seguros/broker',
    'DOM.INSURANCE.ASSISTANCE_LINES': 'seguros/broker', 'DOM.FINANCE.RATES_DISCLOSURE': 'finanzas/creditos',
    'DOM.FINANCE.FRAUD_KYC': 'finanzas/creditos', 'DOM.LEGAL.SCOPE_CONFIDENTIALITY': 'servicios_profesionales/abogados',
    'DOM.LEGAL.URGENT_DEADLINES': 'servicios_profesionales/abogados', 'DOM.MINORS.GUARDIAN_CONSENT': 'education/universitaria',
    'DOM.HOME_SAFETY.HAZARD_PROTOCOL': 'servicios_hogar/plomeria', 'DOM.HOME_SAFETY.AUTHORITY_CHECK': 'servicios_hogar/cerrajeria',
};

type Build = (s: TenantSnapshot, id: string) => void;
interface Case { pass: Build; fail: Build }

const service = (s: TenantSnapshot, fields: Record<string, unknown> = {}, extra = {}) =>
    item(s, 'appointment', { name: 'Limpieza', description: 'Limpieza dental completa', duration: { min: 30, unit: 'min' }, price: 80000, includes: [], ...fields }, { priceType: 'fijo', priceStatus: 'confirmed', ...extra });

const CUSTOM: Record<string, Case> = {
    'CORE.IDENTITY.NAME': { pass: (s, id) => val(s, id, { display_name: 'Clínica Sonrisa' }), fail: (s, id) => val(s, id, { display_name: 'Mi negocio' }) },
    'CORE.IDENTITY.DESCRIPTION': {
        pass: (s, id) => val(s, id, { short: 'Consultorio odontológico en Chapinero: limpiezas, ortodoncia e implantes.', audience: ['B2C'] }),
        fail: (s, id) => val(s, id, { short: 'Dentista', audience: ['B2C'] }),
    },
    'CORE.IDENTITY.PROFILE': { pass: () => undefined, fail: s => { s.values['CORE.IDENTITY.PROFILE'] = [{ value: { subtype: 'inmobiliaria/venta' }, status: 'confirmed', origin: 'owner_form' }]; } },
    'CORE.IDENTITY.REGION': { pass: s => region(s), fail: (s, id) => val(s, id, { operating_country: 'CO', timezone: 'America/Bogota' }) },
    'CORE.LOCATIONS.LIST': { pass: (s, id) => val(s, id, { locations: [{ name: 'Sede', is_main: true, address: { city: 'Bogotá', country: 'CO' } }] }), fail: (s, id) => val(s, id, { locations: [{ address: { city: 'Bogotá' } }] }) },
    'CORE.HOURS.REGULAR': {
        pass: (s, id) => val(s, id, { days: WEEK }),
        fail: (s, id) => { val(s, id, { days: WEEK }, { storage: 'settings.businessHours' }); val(s, id, { days: { ...WEEK, sat: [] } }, { storage: 'persona.hours' }); },
    },
    'CORE.HOURS.HOLIDAYS': { pass: (s, id) => val(s, id, { default_rule: 'cerrado', year: 2026 }), fail: (s, id) => val(s, id, { default_rule: 'cerrado', year: 2025 }) },
    'CORE.CONTACT.CHANNELS': { pass: (s, id) => val(s, id, { points: [{ kind: 'phone', value: '+57 300 000 0000' }] }), fail: (s, id) => val(s, id, { points: [{ kind: 'email', value: 'no-es-correo' }] }) },
    'CORE.OFFER.ITEMS': { pass: s => service(s), fail: s => service(s, {}, { contentStatus: 'seeded' }) },
    'CORE.OFFER.PRICE_MODEL': { pass: s => service(s), fail: s => service(s, {}, { priceStatus: 'example', priceType: null }) },
    'CORE.OFFER.ITEM_DETAILS': { pass: s => service(s), fail: s => service(s, { description: null }) },
    'CORE.OFFER.PROMOTIONS': { pass: (s, id) => val(s, id, []), fail: (s, id) => val(s, id, [], { confirmedAt: days(40) }) },
    'CORE.PAYMENT.AGENT_COLLECTS': { pass: (s, id) => val(s, id, { mode: 'no' }), fail: (s, id) => val(s, id, { mode: 'enlace_de_pago' }) },
    'CORE.POLICY.CANCELLATION_CHANGES': {
        pass: (s, id) => val(s, id, { cancel: { deadline: { min: 24, unit: 'h' }, charge: 'ninguno' } }),
        fail: (s, id) => val(s, id, { cancel: { deadline: { min: 24, unit: 'h' } }, summary: 'Cancela con 24 h' }),
    },
    'CORE.POLICY.WARRANTY': { pass: (s, id) => val(s, id, { duration: { min: 12, unit: 'meses' } }), fail: (s, id) => val(s, id, { coverage: 'defectos de fábrica' }) },
    'CORE.POLICY.HOUSE_RULES': {
        pass: (s, id) => val(s, id, [{ topic: 'mascotas', allowed: true, rule: 'Solo en terraza' }, { topic: 'menores', allowed: true, rule: 'Con un adulto' }]),
        fail: (s, id) => val(s, id, [{ topic: 'mascotas', allowed: true, rule: 'Solo en terraza' }]),
    },
    'CORE.HANDOFF.TEAM': { pass: s => admin(s), fail: s => { s.accounts.push({ id: 'u1', role: 'tenant_admin', active: true, emailVerified: false, handoffNotifications: true }); } },
    'CORE.PROC.OFFER_ACCEPTANCE': {
        pass: s => {
            admin(s);
            val(s, 'CORE.HANDOFF.HOURS_SLA', { human_hours: WEEK, sla_in_hours: { min: 2, unit: 'h' }, sla_out_of_hours: 'siguiente_apertura' });
            val(s, 'CORE.PENDING.ROUTING', { channel: ['panel'], sla: { min: 4, unit: 'h' } });
            val(s, 'OBJ.LEAD.WRITE_MODE', WRITE_OK);
        },
        fail: s => admin(s),
    },
    'CORE.PROC.FOLLOW_UP_STATE': {
        pass: s => { admin(s); val(s, 'CORE.PENDING.ROUTING', { channel: ['panel'], sla: { min: 4, unit: 'h' } }); s.platform.followUpRegistry = true; },
        fail: s => { admin(s); val(s, 'CORE.PENDING.ROUTING', { channel: ['panel'], sla: { min: 4, unit: 'h' } }); },
    },
    'CORE.SAFETY.EMERGENCY_BASE': { pass: s => region(s), fail: () => undefined },
    'CORE.KNOWLEDGE.FAQ_HYGIENE': {
        pass: s => { s.texts.push({ id: 'f1', kind: 'faq', title: '¿Horario?', body: 'Abrimos de lunes a viernes de 8:00 a 18:00 y sábados de 9:00 a 13:00.', published: true, status: 'confirmed', origin: 'owner_form' }); },
        fail: s => { s.texts.push({ id: 'f1', kind: 'faq', title: '¿Medios de pago?', body: 'Te confirmo los medios de pago disponibles, cuéntame cómo prefieres pagar.', published: true, status: 'seeded', origin: 'platform_seed' }); },
    },
    'CORE.KNOWLEDGE.SOURCES': { pass: s => { s.texts.push({ id: 'd1', kind: 'document', title: 'Web', body: '', published: true, status: 'confirmed', origin: 'owner_form', accessible: true }); }, fail: () => undefined },
    'CORE.KNOWLEDGE.AGENT_INSTRUCTIONS': {
        pass: (s, id) => val(s, id, { instructions: [{ text: 'Saluda por el nombre', status: 'confirmed', active: true }] }),
        fail: (s, id) => { s.values[id] = [{ value: { instructions: [{ text: 'Ofrece promociones vigentes', status: 'seeded' }] }, status: 'seeded', origin: 'platform_seed' }]; },
    },
    'OBJ.*.CATALOG': { pass: s => service(s), fail: s => service(s, { duration: null }) },
    'OBJ.*.AVAILABILITY_SOURCE': {
        pass: (s, id) => { val(s, id, { source: 'motor_nativo' }); s.availability.appointment = { nativeDaysLoaded: 30 }; },
        fail: (s, id) => { val(s, id, { source: 'motor_nativo' }); s.availability.appointment = { nativeDaysLoaded: 3 }; },
    },
    'OBJ.*.WRITE_MODE': { pass: (s, id) => val(s, id, WRITE_OK), fail: (s, id) => val(s, id, { ...WRITE_OK, mode: 'direct_commit' }) },
    'OBJ.*.CHANGE_RULES': {
        pass: (s, id) => { val(s, id, { agent_can_modify: 'solicitud', agent_can_cancel: 'solicitud' }); val(s, 'CORE.POLICY.CANCELLATION_CHANGES', { cancel: { deadline: { min: 24, unit: 'h' }, charge: 'ninguno' } }); },
        fail: (s, id) => val(s, id, { agent_can_modify: 'solicitud', agent_can_cancel: 'solicitud' }),
    },
    'OBJ.*.ACCOUNT_READ': {
        pass: (s, id) => val(s, id, { readable: true, identity_level: 'otp', status_vocabulary: { confirmed: 'confirmada' } }),
        fail: (s, id) => val(s, id, { readable: true, identity_level: 'canal', status_vocabulary: { confirmed: 'confirmada' } }),
    },
    'OBJ.APPOINTMENT.STAFF': {
        pass: s => { s.staff.activeBookable = 2; service(s, { staff_ids: ['u1'] }); },
        fail: s => { s.staff.activeBookable = 2; service(s, { staff_ids: [] }); },
    },
    'OBJ.FOOD_ORDER.ALLERGENS_DIET': {
        pass: (s, id) => val(s, id, { mode: 'declaración_general', general_statement: 'Cocinamos con maní y gluten; no garantizamos trazas.' }),
        fail: (s, id) => { val(s, id, { mode: 'por_plato' }); item(s, 'food_order', { name: 'Plato', allergens: [] }, { fieldStatus: { allergens: 'seeded' } }); },
    },
    'OBJ.REAL_ESTATE.COSTS': {
        pass: (s, id) => { item(s, 'real_estate', { operation: 'sale' }); val(s, id, { commission: { sale: '3 %' } }); },
        fail: (s, id) => { item(s, 'real_estate', { operation: 'sale' }); val(s, id, { commission: {} }); },
    },
    'OBJ.SERVICE_REQUEST.EMERGENCY_SERVICE': { pass: (s, id) => val(s, id, { offered: false }), fail: (s, id) => val(s, id, { offered: true }) },
    'PROF.P06.TRAVEL_DOCS': {
        pass: (s, id) => val(s, id, [{ destination: 'México', official_source_url: 'https://www.gob.mx' }]),
        fail: (s, id) => val(s, id, [{ destination: 'México', documents: ['pasaporte'] }]),
    },
    'PROF.P09.PREPARATIONS': { pass: s => service(s, { preparation_ref: 'no_requiere' }), fail: s => service(s) },
    'PROF.P12.CONTRAINDICATIONS_AFTERCARE': { pass: s => service(s, { contraindications: [] }), fail: s => service(s) },
    'PROF.P15.ADMISSIONS_CALENDAR': {
        pass: (s, id) => val(s, id, [{ period: '2027-1', deadline: '2026-12-01' }]),
        fail: (s, id) => val(s, id, [{ period: '2026-2', deadline: '2026-06-01' }]),
    },
    'DOM.HEALTH.EMERGENCY_PROTOCOL': {
        pass: (s, id) => { region(s); val(s, id, { own_urgent_line: 'ninguna', red_flags_accepted: true }); },
        fail: (s, id) => { region(s); val(s, id, { own_urgent_line: 'ninguna' }); },
    },
    'DOM.MENTAL_HEALTH.CRISIS_PROTOCOL': {
        pass: (s, id) => { region(s); val(s, id, { professional_alert: ['u1'] }); },
        fail: (s, id) => { region(s, { emergency: { medical: '123', reviewStatus: 'unreviewed' } }); val(s, id, { professional_alert: ['u1'] }); },
    },
    'DOM.PHARMACY.PRESCRIPTION': {
        pass: (s, id) => { item(s, 'catalog_order', { name: 'Losartán 50', requires_prescription: 'sí' }); val(s, id, { pharmacist: 'u1' }); },
        fail: (s, id) => { item(s, 'catalog_order', { name: 'Losartán 50', requires_prescription: false }, { fieldStatus: { requires_prescription: 'seeded' } }); val(s, id, { pharmacist: 'u1' }); },
    },
    'DOM.INSURANCE.ASSISTANCE_LINES': {
        pass: (s, id) => { item(s, 'insurance', { product_name: 'Auto', insurers: ['Sura'] }); val(s, id, { lines: [{ insurer: 'Sura', line: '+57 601 000 0000' }] }); },
        fail: (s, id) => { item(s, 'insurance', { product_name: 'Auto', insurers: ['Sura'] }); val(s, id, { lines: [] }); },
    },
    'DOM.FINANCE.RATES_DISCLOSURE': {
        pass: (s, id) => val(s, id, { simulation_disclaimer: 'Simulación informativa', products: [{ rate_ea: '24 %', valid_from: days(5) }] }),
        fail: (s, id) => val(s, id, { simulation_disclaimer: 'Simulación informativa', products: [{ rate_ea: '24 %', valid_from: days(60) }] }),
    },
    'DOM.HOME_SAFETY.HAZARD_PROTOCOL': { pass: (s, id) => { region(s); val(s, id, { instructions: 'Cierra la llave del gas' }); }, fail: (s, id) => region(s) },
};

/** Valor que cumple un predicado genérico, armado desde sus parámetros. */
function genericPass(s: TenantSnapshot, id: string, kind: string, params: Record<string, any>): void {
    if (kind === 'default_accepted') { s.defaultsAcceptance.push({ specVersion: spec.specVersion, ids: [id], acceptedBy: 'u1', acceptedAt: NOW.toISOString() }); return; }
    if (kind === 'value_or_empty') { val(s, id, []); return; }
    if (kind === 'count_min') { val(s, id, { [params.path]: Array.from({ length: params.min }, (_, k) => `m${k}`) }); return; }
    if (kind === 'platform_pack') { region(s, { [params.field]: { retracto: '5 días' } }); return; }
    const fields: string[] = params.fields ?? params.any_of[0];
    const value: Record<string, any> = {};
    for (const f of fields) {
        const parts = f.replace(/\[\]$/, '').split('.');
        let cur = value;
        parts.slice(0, -1).forEach(p => { cur = (cur[p] ??= {}); });
        cur[parts[parts.length - 1]] = f.endsWith('[]') ? ['x'] : 'valor';
    }
    val(s, id, value);
}

const keys = [...new Set(spec.order.map(id => spec.requirements[id].templateId ?? id))];
const instanceOf = (key: string) => (key.startsWith('OBJ.*.') ? key.replace('OBJ.*.', 'OBJ.APPOINTMENT.') : key);

describe('evaluadores: un caso que cumple y uno que no, por requisito', () => {
    it('cubre los 95 requisitos de la especificación', () => {
        expect(keys).toHaveLength(95);
        const custom = keys.filter(k => (spec.requirements[instanceOf(k)] ?? spec.requirements[k]).predicateKind === 'custom');
        expect(custom.filter(k => !CUSTOM[k])).toEqual([]);
    });

    it.each(keys)('%s', key => {
        const id = instanceOf(key);
        const req = spec.requirements[id];
        const subtype = SUBTYPE[key] ?? 'salud/dental';
        const pass = base(subtype);
        const fail = base(subtype);
        if (req.predicateKind === 'custom') {
            CUSTOM[key].pass(pass, id);
            CUSTOM[key].fail(fail, id);
        } else {
            genericPass(pass, id, req.predicateKind, req.predicateParams as Record<string, any>);
        }
        const ok = evalReq(pass, id);
        const ko = evalReq(fail, id);
        expect({ id, applies: ok.applies }).toEqual({ id, applies: true });
        expect({ id, result: ok.result, levels: ok.levelResults, detail: ok.detail }).toMatchObject({ id, result: 'cumple' });
        expect(Object.values(ok.levelResults ?? {}).every(r => r === 'cumple')).toBe(true);
        expect(ko.applies).toBe(true);
        expect(ko.result === 'cumple' && Object.values(ko.levelResults ?? {}).every(r => r === 'cumple')).toBe(false);
        expect(ko.gap?.message).toBeTruthy();
    });

    it('un valor sembrado o de ejemplo nunca cumple un predicado genérico', () => {
        const s = base('salud/dental');
        s.values['CORE.PAYMENT.METHODS'] = [{ value: { methods: ['efectivo'] }, status: 'seeded', origin: 'platform_seed' }];
        s.values['CORE.OFFER.NOT_OFFERED'] = [{ value: [], status: 'seeded', origin: 'platform_seed', legacyRule: 'L4' }];
        expect(evalReq(s, 'CORE.PAYMENT.METHODS')).toMatchObject({ result: 'no_cumple', valueState: 'sembrado' });
        expect(evalReq(s, 'CORE.OFFER.NOT_OFFERED')).toMatchObject({ result: 'no_cumple', valueState: 'sembrado' });
    });
});
