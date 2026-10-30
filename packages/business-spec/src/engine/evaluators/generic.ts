/**
 * Evaluadores genéricos (C0 §1.1): las formas repetidas se escriben una vez y cada requisito
 * declara en el YAML `predicate_kind` + `predicate_params`.
 */
import { textEvidenceFor } from '../../status';
import type { PredicateKind } from '../../types';
import {
    asList, confirmed, exists, fail, get, nonEmptyList, ok, olderThanDays, refOk, type EvalContext, type Outcome,
} from '../primitives';

const REGION = 'CORE.IDENTITY.REGION';

function present(value: unknown, field: string): boolean {
    return field.endsWith('[]') ? nonEmptyList(get(value, field.slice(0, -2))) : exists(get(value, field));
}

function textFallback(ctx: EvalContext): Outcome | null {
    if (!ctx.req.sources.acceptsTextEvidence) return null;
    const t = textEvidenceFor(ctx.snap.texts, ctx.req.id);
    return t ? ok(`cubierto por texto confirmado «${t.title}»`) : null;
}

const confirmedFields = (ctx: EvalContext): Outcome => {
    const rv = ctx.value;
    if (!confirmed(rv)) return textFallback(ctx) ?? fail(rv);
    const v = rv.record?.value;
    const p = ctx.req.predicateParams;
    const groups: string[][] = Array.isArray(p.any_of) ? p.any_of as string[][] : [p.fields as string[]];
    const missingPerGroup = groups.map(g => g.filter(f => !present(v, f)));
    if (missingPerGroup.some(m => m.length === 0)) return ok();
    const missing = missingPerGroup[0];
    const summary = String(get(v, 'summary') ?? get(v, 'text') ?? '');
    const detail = /\d/.test(summary)
        ? `el texto menciona plazos o cifras, pero faltan los campos: ${missing.join(', ')}`
        : `faltan: ${missing.join(', ')}`;
    return { result: 'no_cumple', cause: 'parcial', detail, params: { campos: missing.join(', ') } };
};

const valueOrEmpty = (ctx: EvalContext): Outcome => {
    const rv = ctx.value;
    if (!confirmed(rv)) return textFallback(ctx) ?? fail(rv);
    const maxAge = Number(ctx.req.predicateParams.max_age_days ?? 0);
    if (maxAge > 0 && olderThanDays(rv.record?.confirmedAt, maxAge, ctx.now)) {
        return { result: 'no_cumple', cause: 'caducado', detail: `sin revisar en ${maxAge} días` };
    }
    return ok(Array.isArray(rv.record?.value) && rv.record?.value.length === 0 ? 'vacío confirmado' : undefined);
};

const defaultAccepted = (ctx: EvalContext): Outcome => {
    if (confirmed(ctx.value)) return ok(ctx.value.record?.origin === 'default_accepted' ? 'default aceptado' : 'configurado');
    const acc = ctx.snap.defaultsAcceptance.find(a => a.ids.includes(ctx.req.id));
    if (acc) return ok(`default aceptado (${acc.specVersion})`);
    return fail(ctx.value);
};

const countMin = (ctx: EvalContext): Outcome => {
    const rv = ctx.value;
    if (!confirmed(rv)) return fail(rv);
    const p = ctx.req.predicateParams;
    const n = asList(get(rv.record?.value, String(p.path))).length;
    return n >= Number(p.min) ? ok(`${n} confirmados`) : { result: 'no_cumple', cause: 'parcial', detail: `${n} de ${p.min}` };
};

const platformPack = (ctx: EvalContext): Outcome => {
    const pack = ctx.snap.platform.countryPack;
    if (!pack) {
        if (!refOk(ctx, REGION)) return { result: 'no_cumple', cause: 'ausente', rootCause: REGION, detail: 'sin país no se resuelve el pack' };
        return { result: 'no_cumple', cause: 'plataforma', detail: 'no hay pack para el país' };
    }
    const field = String(ctx.req.predicateParams.field);
    return exists((pack as unknown as Record<string, unknown>)[field])
        ? ok() : { result: 'no_cumple', cause: 'plataforma', detail: `el pack ${pack.id} no contiene ${field}` };
};

export const GENERIC_EVALUATORS: Readonly<Record<Exclude<PredicateKind, 'custom'>, (ctx: EvalContext) => Outcome>> = {
    confirmed_fields: confirmedFields,
    value_or_empty: valueOrEmpty,
    default_accepted: defaultAccepted,
    count_min: countMin,
    platform_pack: platformPack,
};
