/**
 * C1 · Motor de preparación: evaluate(spec, foto, now) → ReadinessResult. Función pura (C0 §0.2):
 * no lee la base ni llama a un LLM; la misma foto y la misma hora dan el mismo resultHash.
 *
 * `resultHash` identifica el CONTENIDO del resultado: excluye `asOf` y `snapshotHash`, que cambian en cada
 * lectura aunque nada haya cambiado (la foto lleva su hora de captura). Así el historial de la API
 * (`readiness_evaluations`, C0 §2.7) guarda una fila solo cuando el resultado cambió (ADR 0004).
 */
import { compose, type EffectiveRequirement } from '../compose';
import { resolveFacts } from '../facts';
import { hashOf } from '../hash';
import { isInheritedRecord, resolveValue, type ResolvedValue } from '../status';
import type {
    CompiledSpec, Gap, GapCause, Level, ReadinessResult, RequirementEvaluation, RequirementResult, TenantSnapshot,
} from '../types';
import { CUSTOM_EVALUATORS, GENERIC_EVALUATORS } from './evaluators';
import { OBJECT_NOUNS, causeOf, type EvalContext, type Outcome } from './primitives';

/** Mensaje del hueco según la causa (schema §9: `gap_message` texto o mapa por causa). */
export function gapMessageFor(e: EffectiveRequirement, spec: CompiledSpec, cause: GapCause, params: Record<string, string | number> = {}): string {
    const req = e.req;
    const objDefault = req.object && req.templateId === 'OBJ.*.AVAILABILITY_SOURCE' ? spec.objects[req.object]?.availabilityDefault?.gap_message : undefined;
    let text: string;
    if (objDefault) text = objDefault;
    else if (typeof req.gapMessage === 'string') text = req.gapMessage;
    else {
        const map = req.gapMessage;
        text = map[cause] ?? (cause === 'sembrado' || cause === 'ejemplo' || cause === 'caducado' || cause === 'parcial' ? map.ausente : undefined)
            ?? map.ausente ?? Object.values(map)[0] ?? '';
    }
    const noun = req.object ? OBJECT_NOUNS[req.object] : undefined;
    const all: Record<string, string | number> = {
        ...(noun ? { objeto: noun.records, 'ítems': noun.items, reservas: noun.records, 'trámite': 'el trámite principal' } : {}),
        ...params,
    };
    return text.replace(/\{([^{}]+)\}/g, (m, key: string) => (key in all ? String(all[key]) : key));
}

export function evaluate(spec: CompiledSpec, snap: TenantSnapshot, now?: Date): ReadinessResult {
    const at = now ?? new Date(snap.capturedAt);
    const facts = resolveFacts(spec, snap, at);
    const effective = compose(spec, facts);
    const byId = new Map(effective.map(e => [e.req.id, e]));

    const values = new Map<string, ResolvedValue>();
    const valueOf = (id: string): ResolvedValue => {
        if (!values.has(id)) values.set(id, resolveValue(snap.values[id], at));
        return values.get(id) as ResolvedValue;
    };
    const outcomes = new Map<string, Outcome | null>();
    const running = new Set<string>();
    const run = (id: string): Outcome | null => {
        if (outcomes.has(id)) return outcomes.get(id) as Outcome | null;
        const e = byId.get(id);
        if (!e || !e.applies) { outcomes.set(id, null); return null; }
        if (running.has(id)) return { result: 'no_cumple', cause: 'ausente', detail: 'dependencia circular' };
        running.add(id);
        const ctx: EvalContext = {
            req: e.req, spec, snap, now: at, facts, params: e.params, value: valueOf(id), valueOf,
            resultOf: (other: string): RequirementResult | null => run(other)?.result ?? null,
        };
        const evaluator = e.req.predicateKind === 'custom'
            ? CUSTOM_EVALUATORS[e.req.templateId ?? e.req.id]
            : GENERIC_EVALUATORS[e.req.predicateKind];
        const outcome = evaluator ? evaluator(ctx) : { result: 'no_cumple' as const, cause: 'ausente' as const, detail: 'sin evaluador' };
        running.delete(id);
        outcomes.set(id, outcome);
        return outcome;
    };

    const requirements: RequirementEvaluation[] = [];
    const counted = new Map<string, Set<Level>>();
    const platformGaps: ReadinessResult['platformGaps'] = [];
    const qualityWarnings: ReadinessResult['qualityWarnings'] = [];

    for (const e of effective) {
        const req = e.req;
        const outcome = run(req.id);
        const base = { id: req.id, title: req.title, layer: req.layer, level: e.level, rule: e.rule, platform: req.platform, derived: req.derived };
        if (!outcome) { requirements.push({ ...base, applies: false, result: 'n/a', valueState: null }); continue; }
        const rv = valueOf(req.id);
        const ev: RequirementEvaluation = {
            ...base, applies: true, result: outcome.result, valueState: rv.state,
            ...(outcome.ratio ? { ratio: outcome.ratio } : {}),
            ...(outcome.levelResults ? { levelResults: outcome.levelResults } : {}),
            ...(outcome.detail ? { detail: outcome.detail } : {}),
        };
        const failing = outcome.result !== 'cumple' || Object.values(outcome.levelResults ?? {}).some(r => r !== 'cumple');
        if (failing) {
            const cause = outcome.cause ?? causeOf(rv.state);
            const gap: Gap = {
                cause, message: gapMessageFor(e, spec, cause, outcome.params),
                intents: req.answers.map(id => ({ id, title: spec.intents[id]?.title ?? id })),
                uiTarget: req.uiTarget, uiToday: req.uiToday, rootOf: [],
                ...(outcome.rootCause ? { rootCause: outcome.rootCause } : {}),
            };
            ev.gap = gap;
            const platformOnly = cause === 'plataforma' && !outcome.rootCause;
            if (platformOnly) platformGaps.push({ id: req.id, message: `${gap.message}${outcome.detail ? ` (${outcome.detail})` : ''}` });
            else if (!req.derived) {
                const levels = new Set<Level>();
                if (outcome.levelResults) {
                    for (const [lvl, r] of Object.entries(outcome.levelResults)) if (r !== 'cumple') levels.add(lvl === 'bloqueante' ? e.level : 'necesario');
                } else levels.add(e.level);
                counted.set(req.id, levels);
            }
        } else if (rv.state === 'confirmado' && isInheritedRecord(rv.record)) {
            qualityWarnings.push({ id: req.id, message: 'dato heredado: confírmalo', uiTarget: req.uiTarget });
        }
        for (const w of outcome.warnings ?? []) qualityWarnings.push({ id: req.id, message: w, uiTarget: req.uiTarget });
        for (const s of rv.shadowed) qualityWarnings.push({ id: req.id, message: `otra fuente (${s.storage ?? s.origin}) dice otra cosa; manda el campo confirmado`, uiTarget: req.uiTarget });
        requirements.push(ev);
    }

    // causa raíz: el hueco se muestra una vez, en la raíz (schema §9)
    const evalById = new Map(requirements.map(r => [r.id, r]));
    for (const r of requirements) {
        const root = r.gap?.rootCause ? evalById.get(r.gap.rootCause) : undefined;
        if (root?.gap) root.gap.rootOf.push(r.id);
        else if (r.gap?.rootCause) delete r.gap.rootCause;
    }

    const applicable = requirements.filter(r => r.applies);
    const failingAt = (lvl: Level) => [...counted.entries()].filter(([, ls]) => ls.has(lvl)).map(([id]) => id);
    const blockingGaps = failingAt('bloqueante');
    const necessaryFailing = failingAt('necesario');
    const recommendedFailing = failingAt('recomendado');
    const verdict = blockingGaps.length ? 'no_listo' : necessaryFailing.length ? 'limitado' : 'listo';

    const byArea: Record<string, { ok: number; total: number }> = {};
    for (const r of applicable.filter(x => !x.derived)) {
        const area = r.id.startsWith('CORE.') ? r.id.split('.').slice(0, 2).join('.') : r.layer;
        byArea[area] ??= { ok: 0, total: 0 };
        byArea[area].total++;
        if (r.result === 'cumple') byArea[area].ok++;
    }
    const r5 = applicable.filter(r => r.level === 'recomendado');
    const r5Pct = r5.length ? Math.round((r5.filter(r => r.result === 'cumple').length / r5.length) * 100) : 100;

    const intents = new Map<string, Set<string>>();
    for (const id of necessaryFailing) for (const a of evalById.get(id)?.gap?.intents ?? []) {
        if (!intents.has(a.id)) intents.set(a.id, new Set());
        intents.get(a.id)?.add(id);
    }
    const limitedIntents = [...intents.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([id, reqs]) => ({ id, title: spec.intents[id]?.title ?? id, requirementIds: [...reqs].sort() }));

    const result: Omit<ReadinessResult, 'resultHash'> = {
        specVersion: spec.specVersion,
        tenant: snap.tenant,
        asOf: at.toISOString(),
        snapshotHash: hashOf(snap),
        verdict,
        config: {
            profileId: facts.profileId,
            subtype: facts.subtypeId,
            objects: facts.objects.map(o => ({ object: o.object, variant: o.variant, writeMode: facts.writeModes[o.object]?.mode ?? 'none', writeModeDeclared: facts.writeModes[o.object]?.declared ?? false })),
            domains: [...facts.domains].sort(),
            facts: {
                modality: facts.modality, delivery_offered: facts.deliveryOffered, has_prepayment: facts.hasPrepayment,
                sells_goods: facts.sellsGoods, hours_always_open: facts.hoursAlwaysOpen, staff_count: facts.staffCount,
                undeclared: facts.undeclaredFacts, sources: facts.sources,
            },
        },
        counts: {
            applicable: applicable.length,
            blocking: applicable.filter(r => r.level === 'bloqueante').length,
            blockingFailing: blockingGaps.length,
            necessary: applicable.filter(r => r.level === 'necesario').length,
            necessaryFailing: necessaryFailing.length,
            recommended: r5.length,
            recommendedFailing: recommendedFailing.length,
        },
        requirements,
        blockingGaps,
        necessaryGaps: necessaryFailing.filter(id => !blockingGaps.includes(id)),
        recommendedGaps: recommendedFailing.filter(id => !blockingGaps.includes(id) && !necessaryFailing.includes(id)),
        platformGaps,
        qualityWarnings,
        coverage: { byArea, r5Pct },
        limitedIntents,
    };
    const { asOf: _asOf, snapshotHash: _snapshotHash, ...content } = result;
    return { ...result, resultHash: hashOf(content) };
}
