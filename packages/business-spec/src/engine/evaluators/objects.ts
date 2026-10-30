/** Evaluadores `custom` de la plantilla OBJ.* (uno por plantilla, para todos los objetos) y de los extras de objeto. */
import { RESERVABLE_OBJECTS } from '../../facts';
import type { ItemRecord } from '../../types';
import {
    OBJECT_NOUNS, activeItems, asObject, confirmed, cval, exists, fail, fieldStatus, itemConfirmed, nonEmptyList,
    ok, olderThanDays, ratioOutcome, refOk, type EvalContext, type Evaluator,
} from '../primitives';

const CANCELLATION = 'CORE.POLICY.CANCELLATION_CHANGES';
const IDENTITY_RANK: Record<string, number> = { canal: 1, codigo: 2, 'código_de_reserva': 2, otp: 3, humano: 4 };
const STRONG_IDENTITY_DOMAINS = ['health', 'mental_health', 'insurance', 'finance', 'legal'];
const FIELD_LABELS: Record<string, string> = {
    price_type: 'tipo de precio', category: 'categoría', price: 'precio', duration: 'duración', name: 'nombre',
    includes: 'qué incluye', excludes: 'qué no incluye', meeting_point: 'punto de encuentro', destination: 'destino', zone: 'zona',
    country: 'país', address_privacy: 'privacidad de la dirección', price_per_passenger_type: 'precio por tipo de pasajero',
    confirmación: 'datos reales (los del alta son de ejemplo)',
};

const noun = (o: string) => OBJECT_NOUNS[o] ?? { records: o, items: o, item: o };
const objectOf = (ctx: EvalContext): string => String(ctx.req.object);

function itemHasField(i: ItemRecord, f: string): boolean {
    if (f === 'price_type') return Boolean(i.priceType);
    if (f === 'active') return typeof i.active === 'boolean';
    const v = i.fields[f];
    // el ítem sembrado ya falla por «confirmación»; aquí solo cuenta el campo ausente o con valor por defecto (L4)
    return exists(v) && i.fieldStatus?.[f] !== 'seeded';
}

/** OBJ.*.CATALOG: todos los ítems activos con sus campos required confirmados; parcial = proporción. */
const catalog: Evaluator = ctx => {
    const o = objectOf(ctx);
    const items = activeItems(ctx, o);
    const required = ctx.spec.objects[o].catalogFields.required;
    const missing = new Set<string>();
    let okCount = 0;
    for (const i of items) {
        const miss = required.filter(f => !itemHasField(i, f));
        if (!itemConfirmed(i)) miss.push('confirmación');
        if (miss.length) miss.forEach(m => missing.add(m)); else okCount++;
    }
    const allSeeded = items.length > 0 && items.every(i => !itemConfirmed(i));
    const out = ratioOutcome(okCount, items.length, 'ausente', {
        params: { n: items.length - okCount, m: items.length, 'ítems': noun(o).items, campos: [...missing].map(f => FIELD_LABELS[f] ?? f).join(', '), objeto: noun(o).records },
    });
    if (out.result !== 'cumple' && allSeeded) out.cause = 'sembrado';
    return out;
};

/** OBJ.*.AVAILABILITY_SOURCE: fuente declarada (o default aceptado, D-16) y con datos frescos. */
const availabilitySource: Evaluator = ctx => {
    const o = objectOf(ctx);
    const def = ctx.spec.objects[o];
    const params = { objeto: noun(o).records };
    if (!confirmed(ctx.value)) {
        if (def.availabilityDefault && ctx.snap.defaultsAcceptance.some(a => a.ids.includes(ctx.req.id))) return ok(`default aceptado: ${def.availabilityDefault.source}`);
        return fail(ctx.value, undefined, { params });
    }
    const v = cval(ctx.value);
    const src = String(v.source ?? '');
    const info = ctx.snap.availability[o] ?? {};
    const direct = ctx.facts.writeMode(o) === 'direct_commit';
    if (src === 'ninguna') return direct ? { result: 'no_cumple', cause: 'parcial', detail: 'direct_commit exige motor o integración', params } : ok('declarada: ninguna');
    if (src === 'motor_nativo') {
        const days = info.nativeDaysLoaded ?? 0;
        return days >= 14 ? ok(`${days} días cargados`) : { result: 'no_cumple', cause: 'parcial', detail: `solo ${days} días cargados (mínimo 14)`, params };
    }
    if (src.startsWith('integraci') || src === 'ical') {
        return olderThanDays(info.integrationSyncedAt, 1, ctx.now)
            ? { result: 'no_cumple', cause: 'caducado', detail: 'integración sin sincronizar en 24 h', params } : ok(src);
    }
    if (src === 'estado_manual') {
        const maxHours = Number(v.freshness_hours ?? 0);
        if (maxHours > 0 && olderThanDays(info.manualUpdatedAt, maxHours / 24, ctx.now)) return { result: 'no_cumple', cause: 'caducado', detail: `estado manual de más de ${maxHours} h`, params };
        return ok('estado manual');
    }
    return { result: 'no_cumple', cause: 'parcial', detail: `fuente desconocida «${src}»`, params };
};

/** OBJ.*.WRITE_MODE: modo confirmado; si ≠ none, campos y términos; request ⇒ SLA; direct ⇒ ref_cumple(AVAILABILITY_SOURCE). */
const writeMode: Evaluator = ctx => {
    const o = objectOf(ctx);
    const params = { objeto: noun(o).records };
    if (!confirmed(ctx.value)) return fail(ctx.value, undefined, { params });
    const v = cval(ctx.value);
    const mode = String(v.mode ?? '');
    if (!['direct_commit', 'request_to_business', 'none'].includes(mode)) return { result: 'no_cumple', cause: 'parcial', detail: 'mode sin declarar', params };
    if (mode === 'none') return ok('none: solo informa');
    const problems: string[] = [];
    if (!nonEmptyList(v.required_fields)) problems.push('required_fields');
    if (!exists(v.confirmation_terms) || (Array.isArray(v.confirmation_terms) && !v.confirmation_terms.length)) problems.push('confirmation_terms');
    if (mode === 'request_to_business' && !exists(v.business_confirm_sla)) problems.push('business_confirm_sla');
    if (o === 'appointment' && ctx.facts.domains.has('health') && v.consent_required !== true) problems.push('consent_required (dominio health)');
    if (problems.length) return { result: 'no_cumple', cause: 'parcial', detail: `faltan: ${problems.join(', ')}`, params };
    const avail = `OBJ.${o.toUpperCase()}.AVAILABILITY_SOURCE`;
    if (mode === 'direct_commit' && ctx.spec.requirements[avail] && !refOk(ctx, avail)) {
        return { result: 'no_cumple', cause: 'ausente', rootCause: avail, detail: 'direct_commit sin fuente de disponibilidad', params };
    }
    return ok(mode);
};

/** OBJ.*.CHANGE_RULES (D-07): terms resuelve a CANCELLATION si aplica; si es n/a, al policy_terms propio. */
const changeRules: Evaluator = ctx => {
    const o = objectOf(ctx);
    const params = { objeto: noun(o).records };
    if (!confirmed(ctx.value)) return fail(ctx.value, undefined, { params });
    const v = cval(ctx.value);
    const missing = ['agent_can_modify', 'agent_can_cancel'].filter(f => !exists(v[f]));
    if (missing.length) return { result: 'no_cumple', cause: 'parcial', detail: `sin ${missing.join(', ')}`, params };
    if ((v.agent_can_modify === 'directo' || v.agent_can_cancel === 'directo') && ctx.facts.writeMode(o) !== 'direct_commit') {
        return { result: 'no_cumple', cause: 'parcial', detail: '«directo» exige WRITE_MODE = direct_commit', params };
    }
    const cancelApplies = RESERVABLE_OBJECTS.has(o) && ctx.resultOf(CANCELLATION) !== null;
    const terms = v.terms;
    if (cancelApplies && (!exists(terms) || typeof terms === 'string')) {
        return refOk(ctx, CANCELLATION) ? ok('terms = CORE.POLICY.CANCELLATION_CHANGES')
            : { result: 'no_cumple', cause: 'ausente', rootCause: CANCELLATION, detail: 'la política general de cancelación no cumple', params };
    }
    const t = asObject(terms);
    const hasLimit = exists(t.deadline) || exists(t.cancel_until_status);
    return hasLimit && exists(t.charge) ? ok('terms propios')
        : { result: 'no_cumple', cause: 'parcial', detail: 'terms sin plazo (o cancel_until_status) y cargo', params };
};

/** OBJ.*.ACCOUNT_READ: readable declarado; si true, vocabulario de estados e identidad ≥ mínimo del dominio. */
const accountRead: Evaluator = ctx => {
    const o = objectOf(ctx);
    const params = { reservas: noun(o).records };
    if (!confirmed(ctx.value)) return fail(ctx.value, undefined, { params });
    const v = cval(ctx.value);
    if (typeof v.readable !== 'boolean') return { result: 'no_cumple', cause: 'parcial', detail: 'readable sin declarar', params };
    if (!v.readable) return ok('el cliente no ve sus registros por chat');
    const min = STRONG_IDENTITY_DOMAINS.some(d => ctx.facts.domains.has(d)) ? 'otp' : 'canal';
    const level = String(v.identity_level ?? ctx.spec.objects[o].defaultIdentity);
    const problems: string[] = [];
    if (!Object.keys(asObject(v.status_vocabulary)).length) problems.push('status_vocabulary');
    if ((IDENTITY_RANK[level] ?? 0) < IDENTITY_RANK[min]) problems.push(`identity_level ${level} < ${min}`);
    return problems.length ? { result: 'no_cumple', cause: 'parcial', detail: problems.join('; '), params } : ok();
};

const staff: Evaluator = ctx => {
    const items = activeItems(ctx, 'appointment');
    const okCount = items.filter(i => nonEmptyList(i.fields.staff_ids) && fieldStatus(i, 'staff_ids') === 'confirmed').length;
    return ratioOutcome(okCount, items.length);
};

const allergensDiet: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const v = cval(ctx.value);
    if (v.mode === 'declaración_general' || v.mode === 'declaracion_general') {
        return exists(v.general_statement) ? ok('declaración general') : { result: 'no_cumple', cause: 'parcial', detail: 'declaración vacía' };
    }
    if (v.mode !== 'por_plato') return { result: 'no_cumple', cause: 'parcial', detail: 'mode sin declarar' };
    const items = activeItems(ctx, 'food_order');
    const okCount = items.filter(i => Array.isArray(i.fields.allergens) && fieldStatus(i, 'allergens') === 'confirmed').length;
    return ratioOutcome(okCount, items.length);
};

const realEstateCosts: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const v = cval(ctx.value);
    const listings = activeItems(ctx, 'real_estate');
    const ops = [...new Set(listings.map(l => String(l.fields.operation ?? '')).filter(Boolean))];
    const commission = asObject(v.commission);
    const missingOps = ops.filter(op => !exists(commission[op]));
    const rentNoFee = listings.filter(l => /rent|arriendo|arrend/i.test(String(l.fields.operation)) && !exists(l.fields.admin_fee) && !exists(asObject(v.admin_fee)[l.id]));
    if (!missingOps.length && !rentNoFee.length) return ok();
    return { result: 'no_cumple', cause: 'parcial', detail: `comisión sin declarar: ${missingOps.join(', ') || '—'}; ${rentNoFee.length} arriendo(s) sin administración` };
};

const emergencyService: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const v = cval(ctx.value);
    if (typeof v.offered !== 'boolean') return { result: 'no_cumple', cause: 'parcial', detail: 'offered sin declarar' };
    return !v.offered || exists(v.hours) ? ok() : { result: 'no_cumple', cause: 'parcial', detail: 'urgencias sin horario' };
};

export const OBJECT_EVALUATORS: Readonly<Record<string, Evaluator>> = {
    'OBJ.*.CATALOG': catalog,
    'OBJ.*.AVAILABILITY_SOURCE': availabilitySource,
    'OBJ.*.WRITE_MODE': writeMode,
    'OBJ.*.CHANGE_RULES': changeRules,
    'OBJ.*.ACCOUNT_READ': accountRead,
    'OBJ.APPOINTMENT.STAFF': staff,
    'OBJ.FOOD_ORDER.ALLERGENS_DIET': allergensDiet,
    'OBJ.REAL_ESTATE.COSTS': realEstateCosts,
    'OBJ.SERVICE_REQUEST.EMERGENCY_SERVICE': emergencyService,
};

