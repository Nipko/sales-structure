/**
 * Regla de promoción (ADR-0030 §4, fase 4): cambiar quién responde primero en
 * una cadena exige una medición QA del candidato que iguale o supere a la
 * cabeza actual. Pura: recibe los cambios de cabeza y las últimas mediciones.
 */
import { CATALOG_ROLES, CATALOG_TASKS, type CatalogRole, type LlmCatalogSnapshot, type TaskType } from '../router/llm-catalog';

export type MeasurementBench = 'rehearsal_7t' | 'signed_confirmation' | 'classify_verifier';
export const MEASUREMENT_BENCHES: readonly MeasurementBench[] = ['rehearsal_7t', 'signed_confirmation', 'classify_verifier'];

/** Una medición del candidato vale 14 días; la de la cabeza actual sirve de referencia sin importar su edad. */
export const MEASUREMENT_MAX_AGE_DAYS = 14;
/** El ensayo de 7 tenants tiene ruido de ~1 punto entre corridas iguales (E2x). */
export const REHEARSAL_TOLERANCE = 0.01;

export interface MeasurementLite {
    modelId: string;
    bench: MeasurementBench;
    n: number;
    pass: number;
    passRate: number;
    measuredAt: Date;
    catalogVersion: number | null;
}

export interface HeadChange {
    kind: 'chain' | 'role';
    key: TaskType | CatalogRole;
    from: string | undefined;
    to: string | undefined;
}

export interface PromotionEvidence {
    change: string;
    bench: MeasurementBench;
    candidate: { model: string; passRate: number; n: number; measuredAt: string } | null;
    head: { model: string; passRate: number; n: number; measuredAt: string } | null;
}

export interface PromotionResult {
    problems: string[];
    warnings: string[];
    evidence: PromotionEvidence[];
}

export function headChangeList(from: LlmCatalogSnapshot, to: LlmCatalogSnapshot): HeadChange[] {
    const out: HeadChange[] = [];
    for (const task of CATALOG_TASKS) {
        if (from.chains[task][0] !== to.chains[task][0]) out.push({ kind: 'chain', key: task, from: from.chains[task][0], to: to.chains[task][0] });
    }
    for (const role of CATALOG_ROLES) {
        if (from.roles[role][0] !== to.roles[role][0]) out.push({ kind: 'role', key: role, from: from.roles[role][0], to: to.roles[role][0] });
    }
    return out;
}

export function describeHeadChange(c: HeadChange): string {
    return `${c.kind}:${c.key}:${c.from ?? '-'}->${c.to ?? '-'}`;
}

/** Qué bancos exige cada cambio de cabeza, y con qué tolerancia frente a la cabeza actual. */
function requiredBenches(c: HeadChange): Array<{ bench: MeasurementBench; tolerance: number }> | 'judge' | 'none' {
    if (c.kind === 'chain') {
        if (c.key === 'classify') return [{ bench: 'classify_verifier', tolerance: 0 }];
        return [{ bench: 'rehearsal_7t', tolerance: REHEARSAL_TOLERANCE }, { bench: 'signed_confirmation', tolerance: 0 }];
    }
    // Un juez nuevo cambia la vara con que se miden los demás: no hay banco que lo mida, así que
    // pasa sólo con «publicar sin medición». Los roles auxiliares no tienen banco y no bloquean.
    return c.key === 'judge_quality' || c.key === 'judge_rehearsal' ? 'judge' : 'none';
}

const ageDays = (m: MeasurementLite, now: Date) => (now.getTime() - m.measuredAt.getTime()) / 86_400_000;
const brief = (m: MeasurementLite | undefined) => m
    ? { model: m.modelId, passRate: m.passRate, n: m.n, measuredAt: m.measuredAt.toISOString() }
    : null;

/**
 * - `conversation` / `tool_calling`: `rehearsal_7t` del candidato de menos de 14 días con tasa ≥ la de la
 *   cabeza − 0,01, y `signed_confirmation` con tasa ≥ la de la cabeza.
 * - `classify`: `classify_verifier` sin regresión frente a la cabeza.
 * - Si la cabeza actual no tiene medición en ese banco, basta la del candidato (queda un aviso).
 */
export function promotionCheck(
    changes: readonly HeadChange[],
    latest: (modelId: string, bench: MeasurementBench) => MeasurementLite | undefined,
    now: Date = new Date(),
): PromotionResult {
    const problems: string[] = [];
    const warnings: string[] = [];
    const evidence: PromotionEvidence[] = [];
    for (const change of changes) {
        const label = describeHeadChange(change);
        const rule = requiredBenches(change);
        if (rule === 'none') { warnings.push(`role_head_change_without_bench:${label}`); continue; }
        if (rule === 'judge') { problems.push(`judge_change_requires_unmeasured:${label}`); continue; }
        if (!change.to) { problems.push(`empty_head:${label}`); continue; }
        for (const { bench, tolerance } of rule) {
            const candidate = latest(change.to, bench);
            const head = change.from ? latest(change.from, bench) : undefined;
            evidence.push({ change: label, bench, candidate: brief(candidate), head: brief(head) });
            if (!candidate) { problems.push(`measurement_missing:${bench}:${change.to}`); continue; }
            const age = ageDays(candidate, now);
            if (age > MEASUREMENT_MAX_AGE_DAYS) { problems.push(`measurement_stale:${bench}:${change.to}:${Math.floor(age)}d`); continue; }
            if (!head) { warnings.push(`no_head_baseline:${bench}:${change.from ?? '-'}`); continue; }
            if (candidate.passRate + 1e-9 < head.passRate - tolerance) {
                problems.push(`measurement_below_head:${bench}:${change.to}:${candidate.passRate.toFixed(4)}<${head.passRate.toFixed(4)}`
                    + (tolerance ? `-${tolerance}` : ''));
            }
        }
    }
    return { problems, warnings, evidence };
}

/**
 * Resumen de una corrida de `measure.cjs` como medición `rehearsal_7t`: acierto es `answered` o
 * `missing_data`; los `error` (infraestructura) no cuentan en `n`. Es el mismo criterio de
 * `compare2.py` con el que se eligió el catálogo de ADR-0029.
 */
export function summarizeRehearsalRuns(results: ReadonlyArray<{ runs?: ReadonlyArray<{ results?: ReadonlyArray<{ outcome?: string }> | null; costUsd?: number | null; completedCount?: number | null }> }>):
    { n: number; pass: number; errors: number; passRate: number; costPerCaseUsd: number | null } {
    let n = 0, pass = 0, errors = 0, cost = 0, cases = 0;
    for (const tenant of results) {
        for (const run of tenant.runs ?? []) {
            for (const c of run.results ?? []) {
                if (c.outcome === 'error') { errors++; continue; }
                n++;
                if (c.outcome === 'answered' || c.outcome === 'missing_data') pass++;
            }
            if (typeof run.costUsd === 'number') { cost += run.costUsd; cases += run.completedCount ?? run.results?.length ?? 0; }
        }
    }
    return { n, pass, errors, passRate: n ? Math.round((pass / n) * 10_000) / 10_000 : 0, costPerCaseUsd: cases ? Math.round((cost / cases) * 1e6) / 1e6 : null };
}
