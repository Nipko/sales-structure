/** Evaluadores `custom` del núcleo (core.yaml). La prosa de cada predicado está en el YAML. */
import { extractFigures, isTextWithoutData, textEvidenceFor } from '../../status';
import {
    OBJECT_NOUNS, activeItems, asList, asObject, catalogObjects, confirmed, cval, exists, fail, itemConfirmed, nonEmptyList,
    ok, olderThanDays, ratioOutcome, refOk, type EvalContext, type Evaluator,
} from '../primitives';

const REGION = 'CORE.IDENTITY.REGION';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const HHMM = /^([01]\d|2[0-4]):[0-5]\d$/;
const TEMPLATE_DESCRIPTION = [/somos un negocio dedicado a\s*(\.|,|$)/i, /cu[ée]ntame/i, /lorem ipsum/i];
const ADMIN_ROLES = new Set(['tenant_admin', 'owner', 'admin', 'manager']);
/** Cómo se le pregunta al dueño por cada hecho de operación (gap_message.hecho_sin_declarar). */
const FACT_LABELS: Record<string, string> = {
    modality: 'cómo atiendes (presencial, online o a domicilio)', delivery_offered: 'si haces domicilios', has_prepayment: 'si cobras por adelantado',
    simulates_financing: 'si simulas créditos o hipotecas', treats_minors: 'si atiendes a menores', offers_medical_aesthetic: 'si haces procedimientos médico-estéticos',
    admits_minors: 'si admites menores', min_age_under_18: 'si tienes cursos para menores de 18', photographs_minors: 'si fotografías a menores',
};

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** weekly_hours válido (§5): 7 días declarados, tramos HH:MM sin solapes, close > open o cruce de medianoche explícito. */
export function weeklyHoursProblems(v: Record<string, any>): string[] {
    if (v.always_open === true) return [];
    const days = asObject(v.days);
    const problems: string[] = [];
    for (const d of DAYS) {
        if (!(d in days)) { problems.push(`${d} sin declarar`); continue; }
        const spans = asList(days[d]).map(s => asObject(s));
        const sorted = [...spans].sort((a, b) => String(a.open).localeCompare(String(b.open)));
        let lastClose = -1;
        for (const s of sorted) {
            if (!HHMM.test(String(s.open)) || !HHMM.test(String(s.close))) { problems.push(`${d}: tramo inválido`); continue; }
            const o = toMin(s.open);
            const c = toMin(s.close);
            if (c <= o && s.crosses_midnight !== true) problems.push(`${d}: cierre antes de apertura`);
            if (o < lastClose) problems.push(`${d}: tramos solapados`);
            lastClose = c;
        }
    }
    return problems;
}

const name: Evaluator = ctx => {
    const v = cval(ctx.value);
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const n = String(v.display_name ?? '').trim();
    if (!n || n.length > 120) return { result: 'no_cumple', cause: 'ausente' };
    const slug = String(ctx.snap.tenant.slug ?? '').trim().toLowerCase();
    if (n.toLowerCase() === 'mi negocio' || (slug && n.toLowerCase() === slug)) return { result: 'no_cumple', cause: 'sembrado', detail: 'nombre por defecto del alta' };
    return ok();
};

const description: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const v = cval(ctx.value);
    const short = String(v.short ?? '').trim();
    const problems: string[] = [];
    if (short.length < 40) problems.push('short < 40 caracteres');
    if (short.length > 300) problems.push('short > 300 caracteres');
    if (TEMPLATE_DESCRIPTION.some(re => re.test(short))) problems.push('texto de plantilla');
    if (/\$\s?\d|\d{1,2}:\d{2}|\b\d{2,3}\.\d{3}\b/.test(short)) problems.push('contiene precios u horarios');
    if (!nonEmptyList(v.audience)) problems.push('audience vacío');
    return problems.length ? { result: 'no_cumple', cause: short ? 'parcial' : 'ausente', detail: problems.join('; ') } : ok();
};

const profile: Evaluator = ctx => {
    if (!confirmed(ctx.value) || !exists(cval(ctx.value).subtype)) return fail(ctx.value);
    if (!ctx.facts.profileId) return { result: 'no_cumple', cause: 'ausente', detail: `el subtipo ${cval(ctx.value).subtype} no tiene perfil` };
    if (ctx.facts.enabledObjects.length < 1) return { result: 'no_cumple', cause: 'ausente', detail: 'sin objetos habilitados' };
    if (ctx.facts.undeclaredFacts.length) {
        return { result: 'no_cumple', cause: 'hecho_sin_declarar', detail: `hechos sin declarar: ${ctx.facts.undeclaredFacts.join(', ')}`, params: { hecho: ctx.facts.undeclaredFacts.map(f => FACT_LABELS[f] ?? f).join(' y ') } };
    }
    return ok(`${ctx.facts.profileId} · ${ctx.facts.enabledObjects.join(', ')}`);
};

const region: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const v = cval(ctx.value);
    const missing = ['operating_country', 'timezone', 'currency'].filter(f => !exists(v[f]));
    if (missing.length) return { result: 'no_cumple', cause: 'parcial', detail: `faltan: ${missing.join(', ')}` };
    if (!ctx.snap.platform.countryPack) return { result: 'no_cumple', cause: 'plataforma', detail: 'country_pack sin resolver' };
    return ok(`${v.operating_country} · ${v.currency}`);
};

const locationsList: Evaluator = ctx => {
    const modality = ctx.facts.modality;
    if (!modality || modality.length === 0) return { result: 'no_cumple', cause: 'ausente', detail: 'modalidad sin declarar' };
    if (!modality.includes('presencial')) return ok(`modalidad ${modality.join(', ')}`);
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const valid = asList(cval(ctx.value).locations).filter(l => exists(asObject(l.address).city) && exists(asObject(l.address).country));
    return valid.length >= 1 ? ok(`${valid.length} sede(s)`) : { result: 'no_cumple', cause: 'parcial', detail: 'ninguna sede con ciudad y país' };
};

const hoursRegular: Evaluator = ctx => {
    const rv = ctx.value;
    if (rv.state === 'contradictorio') {
        return { result: 'no_cumple', cause: 'contradictorio', detail: `fuentes en conflicto: ${rv.conflicts.map(c => c.storage ?? c.origin).join(' / ')}` };
    }
    if (!confirmed(rv)) return fail(rv);
    const v = cval(rv);
    const problems = weeklyHoursProblems(v);
    if (problems.length) return { result: 'no_cumple', cause: 'parcial', detail: problems.join('; ') };
    // agenda fuera del horario del negocio = contradicción (§7.3)
    const agenda = ctx.snap.availability.appointment;
    if (v.always_open !== true && agenda?.agendaStatus === 'confirmed') {
        const days = asObject(v.days);
        const outside = (agenda.agendaWindows ?? []).filter(w => {
            const spans = asList(days[DAYS[(w.day + 6) % 7]]).map(asObject);
            return !spans.some(s => toMin(String(s.open)) <= toMin(w.open) && toMin(w.close) <= toMin(String(s.close)));
        });
        if (outside.length) return { result: 'no_cumple', cause: 'contradictorio', detail: `${outside.length} franja(s) de agenda fuera del horario` };
    }
    return ok();
};

const holidays: Evaluator = ctx => {
    const rv = ctx.value;
    if (!confirmed(rv)) return fail(rv);
    const v = cval(rv);
    if (!exists(v.default_rule)) return { result: 'no_cumple', cause: 'parcial', detail: 'sin regla general de festivos' };
    const year = ctx.now.getUTCFullYear();
    const declaredYear = Number(v.year ?? (rv.record?.confirmedAt ? new Date(String(rv.record.confirmedAt)).getUTCFullYear() : NaN));
    return declaredYear === year ? ok() : { result: 'no_cumple', cause: 'caducado', detail: `regla de ${declaredYear || 'año desconocido'}; falta ${year}` };
};

const PHONE = /^\+?[0-9][0-9 ()-]{6,}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_RE = /^https?:\/\/\S+$/i;
const contactChannels: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const points = asList(cval(ctx.value).points);
    if (points.length === 0) return ok('vacío confirmado: el canal actual es el contacto');
    const valid = points.filter(p => {
        const kind = String(asObject(p).kind);
        const value = String(asObject(p).value ?? '');
        if (kind === 'phone' || kind === 'whatsapp') return PHONE.test(value);
        if (kind === 'email') return EMAIL.test(value);
        return URL_RE.test(value) || exists(value);
    });
    return valid.length >= 1 ? ok(`${valid.length} canal(es)`) : { result: 'no_cumple', cause: 'parcial', detail: 'ningún canal con formato válido' };
};

/** Por objeto con catálogo: ≥ 1 ítem activo, confirmado y no sembrado. */
const offerItems: Evaluator = ctx => {
    const objs = catalogObjects(ctx);
    if (!objs.length) return ok('ningún objeto habilitado tiene catálogo');
    const failing: string[] = [];
    let anySeeded = false;
    for (const o of objs) {
        const items = activeItems(ctx, o);
        if (!items.some(itemConfirmed)) { failing.push(o); if (items.length) anySeeded = true; }
    }
    if (!failing.length) return ok();
    const noun = OBJECT_NOUNS[failing[0]] ?? { item: 'ítem' };
    return { result: 'no_cumple', cause: anySeeded ? 'sembrado' : 'ausente', detail: `sin ítems reales: ${failing.join(', ')}`, params: { 'servicio/producto/plato…': noun.item, objeto: failing[0] } };
};

/** predicate_by_level: bloqueante = algún precio confirmado o «a cotizar»; necesario = todos con price_type y 0 ejemplos. */
const priceModel: Evaluator = ctx => {
    const items = catalogObjects(ctx).flatMap(o => activeItems(ctx, o));
    const priced = items.filter(i => itemConfirmed(i) && (i.priceType === 'a_cotizar' || i.priceType === 'gratis'
        || (i.priceStatus === 'confirmed' && Number(i.fields.price ?? i.fields.price_per_night ?? i.fields.price_per_day ?? 0) > 0)));
    const examples = items.filter(i => i.priceStatus === 'example');
    const noType = items.filter(i => !i.priceType);
    const blocking = priced.length >= 1 ? 'cumple' : 'no_cumple';
    const needed = items.length > 0 && noType.length === 0 && examples.length === 0 ? 'cumple' : 'no_cumple';
    const levelResults = { bloqueante: blocking, necesario: needed } as const;
    if (blocking === 'cumple' && needed === 'cumple') return ok(undefined, { levelResults });
    const cause = examples.length ? 'ejemplo' : 'ausente';
    const n = examples.length || noType.length || items.length;
    return { result: 'no_cumple', cause, levelResults, params: { n }, detail: `${priced.length} con precio confirmado o a cotizar; ${examples.length} de ejemplo; ${noType.length} sin price_type` };
};

const itemDetails: Evaluator = ctx => {
    let okCount = 0;
    let total = 0;
    for (const o of catalogObjects(ctx)) {
        const def = ctx.spec.objects[o];
        const fields = [...def.catalogFields.required, ...def.catalogFields.optional];
        const listFields = ['includes', 'excludes'].filter(f => fields.includes(f));
        for (const i of activeItems(ctx, o)) {
            total++;
            const hasDescription = itemConfirmed(i) && exists(i.fields.description);
            if (hasDescription && listFields.every(f => Array.isArray(i.fields[f]) && i.fieldStatus?.[f] !== 'seeded')) okCount++;
        }
    }
    return ratioOutcome(okCount, total, 'ausente', { params: { n: total - okCount } });
};

const promotions: Evaluator = ctx => {
    const rv = ctx.value;
    if (!confirmed(rv)) return fail(rv);
    const list = asList(rv.record?.value ?? cval(rv).items);
    if (list.length === 0) {
        return olderThanDays(rv.record?.confirmedAt, 30, ctx.now)
            ? { result: 'no_cumple', cause: 'caducado', detail: '«sin promociones» confirmado hace más de 30 días' } : ok('vacío confirmado');
    }
    const live = list.filter(p => !exists(asObject(p).valid_to) || Date.parse(String(asObject(p).valid_to)) >= ctx.now.getTime());
    return live.length ? ok(`${live.length} vigente(s)`) : { result: 'no_cumple', cause: 'caducado', detail: 'todas las promociones vencieron' };
};

const agentCollects: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const mode = String(cval(ctx.value).mode ?? '');
    if (!['no', 'enlace_de_pago', 'depósito_obligatorio'].includes(mode)) return { result: 'no_cumple', cause: 'parcial', detail: 'mode sin declarar' };
    if (mode !== 'no' && !ctx.snap.integrations.paymentProvider) return { result: 'no_cumple', cause: 'parcial', detail: 'sin proveedor de pagos verificado' };
    return ok(mode);
};

/** Plazo y cargo de cancelación confirmados y sin contradicción con las FAQs (§7.3). */
const cancellation: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const cancel = asObject(cval(ctx.value).cancel);
    const missing = ['deadline', 'charge'].filter(f => !exists(cancel[f]));
    if (missing.length) return { result: 'no_cumple', cause: 'parcial', detail: `cancel sin ${missing.join(', ')}`, params: { campos: missing.join(', ') } };
    const deadline = asObject(cancel.deadline);
    const expected = exists(deadline.min) ? String(deadline.min) : null;
    if (expected) {
        const conflicting = ctx.snap.texts.filter(t => t.published && t.status === 'confirmed' && /cancel/i.test(`${t.title} ${t.body}`)
            && extractFigures(t.body).some(f => /h|hora|d[ií]a/.test(f)) && !extractFigures(t.body).some(f => f.startsWith(expected)));
        if (conflicting.length) return { result: 'no_cumple', cause: 'contradictorio', detail: `FAQ «${conflicting[0].title}» dice otro plazo` };
    }
    return ok();
};

const warranty: Evaluator = ctx => {
    if (!confirmed(ctx.value)) {
        // R1.1 F2: una FAQ confirmada, publicada y con dato que cubre la garantía cumple (accepts_text_evidence)
        const t = ctx.req.sources.acceptsTextEvidence ? textEvidenceFor(ctx.snap.texts, ctx.req.id) : null;
        return t ? ok(`cubierto por texto confirmado «${t.title}»`) : fail(ctx.value);
    }
    const v = cval(ctx.value);
    const byCategory = asObject(v.by_category);
    const cats = Object.keys(byCategory);
    if (cats.length) {
        const okCount = cats.filter(c => exists(asObject(byCategory[c]).duration)).length;
        return ratioOutcome(okCount, cats.length);
    }
    return exists(v.duration) ? ok() : { result: 'no_cumple', cause: 'parcial', detail: 'sin duración' };
};

const houseRules: Evaluator = ctx => {
    if (!confirmed(ctx.value)) return fail(ctx.value);
    const topics = asList(ctx.params.required_topics).map(String);
    const rules = asList(ctx.value.record?.value ?? cval(ctx.value).rules).map(asObject);
    if (!topics.length) return ok(rules.length ? undefined : 'vacío confirmado');
    const missing = topics.filter(t => !rules.some(r => r.topic === t && typeof r.allowed === 'boolean' && exists(r.rule)));
    return missing.length ? { result: 'no_cumple', cause: 'parcial', detail: `sin declarar: ${missing.join(', ')}` } : ok();
};

/** D-09: sin asignación explícita cuenta el admin activo con correo verificado y aviso de traspaso. */
const handoffTeam: Evaluator = ctx => {
    if (confirmed(ctx.value)) {
        const v = cval(ctx.value);
        if (nonEmptyList(v.assignees) && nonEmptyList(v.notify_channels)) return ok('asignación explícita');
    }
    const implicit = ctx.snap.accounts.filter(a => a.active && ADMIN_ROLES.has(a.role) && a.emailVerified && a.handoffNotifications);
    if (implicit.length) return ok(`implícito: ${implicit.length} admin(s) con correo verificado y aviso de traspaso`);
    return fail(ctx.value);
};

/** Derivado: hay salida a una persona y cada oferta habilitada tiene su precondición. */
const offerAcceptance: Evaluator = ctx => {
    const deps = ['CORE.HANDOFF.TEAM', 'CORE.HANDOFF.HOURS_SLA', 'CORE.PENDING.ROUTING',
        ...ctx.facts.enabledObjects.filter(o => ctx.facts.writeMode(o) !== 'none').map(o => `OBJ.${o.toUpperCase()}.WRITE_MODE`)];
    const failing = deps.filter(d => !refOk(ctx, d));
    return failing.length
        ? { result: 'no_cumple', cause: 'ausente', detail: `ofertas sin precondición: ${failing.join(', ')}`, rootCause: failing[0], params: { lista: failing.join(', ') } }
        : ok();
};

const followUpState: Evaluator = ctx => {
    const failing = ['CORE.HANDOFF.TEAM', 'CORE.PENDING.ROUTING'].filter(d => !refOk(ctx, d));
    if (!ctx.snap.platform.followUpRegistry) return { result: 'no_cumple', cause: 'plataforma', detail: 'no existe el registro unificado de pendientes' };
    return failing.length ? { result: 'no_cumple', cause: 'ausente', rootCause: failing[0], detail: failing.join(', ') } : ok();
};

const emergencyBase: Evaluator = ctx => {
    if (!refOk(ctx, REGION)) return { result: 'no_cumple', cause: 'ausente', rootCause: REGION, detail: 'sin país no hay número de emergencias' };
    const em = ctx.snap.platform.countryPack?.emergency;
    const number = em?.general ?? em?.medical;
    if (!number) return { result: 'no_cumple', cause: 'plataforma', detail: 'el pack del país no tiene número general' };
    return ok(number, em?.reviewStatus === 'unreviewed' ? { warnings: ['número de emergencias del pack sin revisar (aviso de plataforma)'] } : {});
};

/** Ninguna FAQ publicada sembrada, sin dato o que promete un efecto sin respaldo. */
const faqHygiene: Evaluator = ctx => {
    const faqs = ctx.snap.texts.filter(t => t.kind === 'faq' && t.published);
    const bad = faqs.filter(t => t.status !== 'confirmed' || isTextWithoutData(t.body));
    if (!bad.length) return ok(`${faqs.length} FAQ(s) con dato`);
    const seeded = bad.filter(t => t.status === 'seeded').length;
    return { result: 'no_cumple', cause: seeded ? 'sembrado' : 'parcial', ratio: { ok: faqs.length - bad.length, total: faqs.length }, params: { n: bad.length }, detail: `${bad.length} de ${faqs.length} (${seeded} sembradas)` };
};

const knowledgeSources: Evaluator = ctx => {
    const docs = ctx.snap.texts.filter(t => t.kind === 'document' && t.accessible !== false && (!t.validTo || Date.parse(t.validTo) >= ctx.now.getTime()));
    if (docs.length) return ok(`${docs.length} documento(s)`);
    if (confirmed(ctx.value) && cval(ctx.value).none === true) return ok('vacío confirmado');
    return fail(ctx.value);
};

/** D-20: ninguna instrucción activa sin revisar (plantilla) ni con un `requires` que no cumple. */
const agentInstructions: Evaluator = ctx => {
    const rv = ctx.value;
    const record = rv.record ?? (rv.conflicts[0] ?? null);
    const list = asList(asObject(record?.value).instructions).map(asObject).filter(i => i.active !== false);
    if (!list.length) return ok('sin instrucciones propias');
    const unreviewed = record?.status === 'seeded' ? list : list.filter(i => i.status === 'seeded');
    const unmet = list.filter(i => exists(i.requires) && !refOk(ctx, String(i.requires)));
    if (!unreviewed.length && !unmet.length) return ok();
    const cause = unreviewed.length ? 'sembrado' : 'parcial';
    const reqs = [...new Set(unmet.map(i => String(i.requires)))];
    return { result: 'no_cumple', cause, params: { n: unreviewed.length + unmet.length, lista: reqs.join(', ') || 'instrucciones de plantilla sin revisar' }, detail: `${unreviewed.length} de plantilla sin revisar; ${unmet.length} con requisito sin cumplir` };
};

export const CORE_EVALUATORS: Readonly<Record<string, Evaluator>> = {
    'CORE.IDENTITY.NAME': name,
    'CORE.IDENTITY.DESCRIPTION': description,
    'CORE.IDENTITY.PROFILE': profile,
    'CORE.IDENTITY.REGION': region,
    'CORE.LOCATIONS.LIST': locationsList,
    'CORE.HOURS.REGULAR': hoursRegular,
    'CORE.HOURS.HOLIDAYS': holidays,
    'CORE.CONTACT.CHANNELS': contactChannels,
    'CORE.OFFER.ITEMS': offerItems,
    'CORE.OFFER.PRICE_MODEL': priceModel,
    'CORE.OFFER.ITEM_DETAILS': itemDetails,
    'CORE.OFFER.PROMOTIONS': promotions,
    'CORE.PAYMENT.AGENT_COLLECTS': agentCollects,
    'CORE.POLICY.CANCELLATION_CHANGES': cancellation,
    'CORE.POLICY.WARRANTY': warranty,
    'CORE.POLICY.HOUSE_RULES': houseRules,
    'CORE.HANDOFF.TEAM': handoffTeam,
    'CORE.PROC.OFFER_ACCEPTANCE': offerAcceptance,
    'CORE.PROC.FOLLOW_UP_STATE': followUpState,
    'CORE.SAFETY.EMERGENCY_BASE': emergencyBase,
    'CORE.KNOWLEDGE.FAQ_HYGIENE': faqHygiene,
    'CORE.KNOWLEDGE.SOURCES': knowledgeSources,
    'CORE.KNOWLEDGE.AGENT_INSTRUCTIONS': agentInstructions,
};

