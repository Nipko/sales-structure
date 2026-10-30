/** Evaluadores `custom` de los extras de perfil (PROF.*) y de los dominios regulados (DOM.*). */
import {
    activeItems, asList, asObject, confirmed, cval, exists, fail, fieldStatus, nonEmptyList, ok, olderThanDays,
    ratioOutcome, refOk, type EvalContext, type Evaluator, type Outcome,
} from '../primitives';

const REGION = 'CORE.IDENTITY.REGION';

/** El pack no resuelve: si la causa es la región del tenant, el hueco va a REGION (schema §9); si no, es de plataforma. */
function packMissing(ctx: EvalContext, what: string): Outcome {
    return refOk(ctx, REGION)
        ? { result: 'no_cumple', cause: 'plataforma', detail: `el pack del país no tiene ${what}` }
        : { result: 'no_cumple', cause: 'ausente', rootCause: REGION, detail: `sin país no se resuelve ${what}` };
}

const travelDocs: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const list = asList(ctx.value.record?.value).map(asObject);
    const okCount = list.filter(d => exists(d.official_source_url)).length;
    return list.length === 0 ? ok('vacío confirmado: sin destinos internacionales') : ratioOutcome(okCount, list.length);
};

/** D-10: cada servicio activo declara preparation_ref o «no requiere»; cada ref con instrucción confirmada. */
const preparations: Evaluator = ctx => {
    const services = activeItems(ctx, 'appointment');
    const instructions = new Map<string, unknown>();
    for (const p of asList(cval(ctx.value).preparations ?? (confirmed(ctx.value) ? ctx.value.record?.value : []))) {
        const e = asObject(p);
        instructions.set(String(e.ref ?? e.service ?? ''), e.instructions);
    }
    const okCount = services.filter(s => {
        const ref = s.fields.preparation_ref;
        if (!exists(ref) || fieldStatus(s, 'preparation_ref') !== 'confirmed') return false;
        return ref === 'no_requiere' || exists(instructions.get(String(ref)));
    }).length;
    return ratioOutcome(okCount, services.length);
};

const contraindications: Evaluator = ctx => {
    const treatments = activeItems(ctx, 'appointment');
    const okCount = treatments.filter(t => Array.isArray(t.fields.contraindications) && fieldStatus(t, 'contraindications') === 'confirmed').length;
    return ratioOutcome(okCount, treatments.length);
};

const admissions: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const periods = asList(ctx.value.record?.value).map(asObject);
    const current = periods.filter(p => exists(p.deadline) && Date.parse(String(p.deadline)) >= ctx.now.getTime());
    return current.length ? ok(`${current.length} periodo(s) vigentes`) : { result: 'no_cumple', cause: 'caducado', detail: 'ningún periodo vigente con fecha límite' };
};

const healthEmergency: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const v = cval(ctx.value);
    const problems: string[] = [];
    if (!exists(v.own_urgent_line)) problems.push('own_urgent_line (o «no tenemos»)');
    if (v.red_flags_accepted !== true && !nonEmptyList(v.red_flags)) problems.push('red_flags sin aceptar');
    if (problems.length) return { result: 'no_cumple', cause: 'parcial', detail: problems.join('; ') };
    return ctx.snap.platform.countryPack?.emergency?.medical ? ok() : packMissing(ctx, 'el número de emergencias médicas');
};

const crisisProtocol: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    if (!exists(cval(ctx.value).professional_alert)) return { result: 'no_cumple', cause: 'parcial', detail: 'sin professional_alert' };
    return ctx.snap.platform.countryPack?.emergency?.crisisLine ? ok() : packMissing(ctx, 'la línea de crisis');
};

const prescription: Evaluator = ctx => {
    const items = activeItems(ctx, 'catalog_order');
    const okCount = items.filter(i => exists(i.fields.requires_prescription) && fieldStatus(i, 'requires_prescription') === 'confirmed').length;
    const pharmacist = confirmed(ctx.value) && (exists(cval(ctx.value).pharmacist) || exists(cval(ctx.value).pharmacist_handoff));
    const out = ratioOutcome(okCount, items.length);
    if (out.result === 'cumple' && !pharmacist) return { result: 'no_cumple', cause: 'parcial', detail: 'sin farmacéutico asignado' };
    return out;
};

const assistanceLines: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const insurers = [...new Set(activeItems(ctx, 'insurance').flatMap(i => asList(i.fields.insurers).map(String)))];
    const lines = asList(cval(ctx.value).lines ?? ctx.value.record?.value).map(asObject);
    const okCount = insurers.filter(ins => lines.some(l => l.insurer === ins && exists(l.line))).length;
    return insurers.length === 0 ? ok('sin aseguradoras activas') : ratioOutcome(okCount, insurers.length);
};

const ratesDisclosure: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const v = cval(ctx.value);
    if (!exists(v.simulation_disclaimer)) return { result: 'no_cumple', cause: 'parcial', detail: 'sin descargo de simulación' };
    const products = asList(v.products).map(asObject);
    const fresh = products.filter(p => exists(p.rate_ea) && !olderThanDays(String(p.valid_from ?? ''), 30, ctx.now)).length;
    const out = ratioOutcome(fresh, products.length);
    if (out.result !== 'cumple' && products.length) out.cause = 'caducado';
    return out;
};

const hazardProtocol: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    if (!exists(cval(ctx.value).instructions)) return { result: 'no_cumple', cause: 'parcial', detail: 'instrucciones sin aceptar' };
    return ctx.snap.platform.countryPack ? ok() : packMissing(ctx, 'los números de bomberos y gas');
};

export const PROFILE_DOMAIN_EVALUATORS: Readonly<Record<string, Evaluator>> = {
    'PROF.P06.TRAVEL_DOCS': travelDocs,
    'PROF.P09.PREPARATIONS': preparations,
    'PROF.P12.CONTRAINDICATIONS_AFTERCARE': contraindications,
    'PROF.P15.ADMISSIONS_CALENDAR': admissions,
    'DOM.HEALTH.EMERGENCY_PROTOCOL': healthEmergency,
    'DOM.MENTAL_HEALTH.CRISIS_PROTOCOL': crisisProtocol,
    'DOM.PHARMACY.PRESCRIPTION': prescription,
    'DOM.INSURANCE.ASSISTANCE_LINES': assistanceLines,
    'DOM.FINANCE.RATES_DISCLOSURE': ratesDisclosure,
    'DOM.HOME_SAFETY.HAZARD_PROTOCOL': hazardProtocol,
};
