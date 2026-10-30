/**
 * Ensayo antes de salir (C0 §1.4 y §1.6, rebanada R7, ADR 0013): tipos de `/readiness/:t/rehearsal/runs` y cómo se
 * agrupa el informe. La API califica; aquí solo se ordena lo que se muestra al dueño:
 * «responde bien», «no lo sabe porque falta X» (con el cajón del dato) y «respondió mal» (fallo de la plataforma).
 */

export type RehearsalRunStatus = "running" | "completed" | "stopped" | "failed" | "interrupted";
export type RehearsalOutcome = "answered" | "missing_data" | "wrong" | "inconclusive" | "error";

export interface RehearsalSummary {
    total: number;
    answered: number;
    missingData: number;
    wrong: number;
    inconclusive: number;
    errors: number;
    passRate: number | null;
    answeredRate: number | null;
}

export interface RehearsalRun {
    id: string;
    agentId: string | null;
    status: RehearsalRunStatus;
    seed: string;
    specVersion: string;
    bankHash: string;
    repeatOf: string | null;
    attempt: number;
    caseCount: number;
    completedCount: number;
    summary: RehearsalSummary | null;
    passRate: number | null;
    models: string[];
    inputTokens: number;
    outputTokens: number;
    judgeCalls: number;
    judgeTokens: number;
    costUsd: number;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
}

export interface RehearsalCheck { id: string; ok: boolean; decisive: boolean; detail: string }

export interface RehearsalResult {
    caseKey: string;
    intentId: string;
    intentTitle: string | null;
    requirementIds: string[];
    requirementTitle: string | null;
    uiTarget: string | null;
    itemId: string | null;
    itemName: string | null;
    language: string;
    expected: string;
    valueState: string | null;
    behavior: string | null;
    outcome: RehearsalOutcome;
    missClass: "dato" | "producto" | null;
    decidedBy: "deterministic" | "judge" | null;
    reason: string | null;
    turns: { customer: string; agent: string }[];
    checks: RehearsalCheck[];
    model: string | null;
    latencyMs: number | null;
}

export interface RehearsalRunDetail extends RehearsalRun {
    results: RehearsalResult[];
    pending: number;
    passHatK: { k: number; cases: number; passAll: number; rate: number | null } | null;
    coverage?: { profile: string | null; languages: string[]; intentsApplicable: string[]; intentsCovered: string[] };
}

export interface IntentGroup {
    intentId: string;
    title: string;
    results: RehearsalResult[];
    counts: Record<RehearsalOutcome, number>;
}

/** Orden del informe: primero lo que pide acción (respondió mal, falta un dato), luego lo inconcluso y lo que está bien. */
const OUTCOME_ORDER: RehearsalOutcome[] = ["wrong", "missing_data", "inconclusive", "error", "answered"];

const emptyCounts = (): Record<RehearsalOutcome, number> => ({ answered: 0, missing_data: 0, wrong: 0, inconclusive: 0, error: 0 });

/** Resultados agrupados por intención (tema de la pregunta); los grupos con fallos van primero. */
export function groupByIntent(results: readonly RehearsalResult[]): IntentGroup[] {
    const groups = new Map<string, IntentGroup>();
    for (const r of results) {
        const g = groups.get(r.intentId) ?? { intentId: r.intentId, title: r.intentTitle ?? r.intentId, results: [], counts: emptyCounts() };
        g.results.push(r);
        g.counts[r.outcome] += 1;
        groups.set(r.intentId, g);
    }
    const rank = (g: IntentGroup) => OUTCOME_ORDER.findIndex(o => g.counts[o] > 0);
    for (const g of groups.values()) g.results.sort((a, b) => OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome));
    return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.intentId.localeCompare(b.intentId, "en", { numeric: true }));
}

/** El caso pide al dueño completar un dato: abre el cajón del primer requisito. */
export const fixesWithData = (r: Pick<RehearsalResult, "outcome" | "missClass" | "requirementIds">): boolean =>
    r.outcome === "missing_data" && r.missClass === "dato" && r.requirementIds.length > 0;

export const isRunActive = (run: Pick<RehearsalRun, "status"> | null | undefined): boolean => run?.status === "running";

/** Porcentaje entero para mostrar (null si no hubo casos calificados). */
export const percent = (rate: number | null | undefined): number | null => (rate === null || rate === undefined ? null : Math.round(rate * 100));

/** Errores conocidos de la API con mensaje propio. */
export const RUN_ERRORS = ["rehearsal_running", "rehearsal_quota_exceeded", "rehearsal_no_agent", "rehearsal_no_cases", "ai_message_quota_exceeded", "rehearsal_deadline", "process_restarted"] as const;
export function runErrorKey(error: string | null | undefined): (typeof RUN_ERRORS)[number] | null {
    if (!error) return null;
    return RUN_ERRORS.find(k => error.includes(k)) ?? null;
}
