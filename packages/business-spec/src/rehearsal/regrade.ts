/**
 * Recalificación sin agente y acuerdo con la revisión humana (E1.1, ADR 0014).
 *
 * Las respuestas de una medición quedan guardadas (fase E: `rehearsal_results`). Para calibrar el instrumento no hace
 * falta volver a correr el agente: con el generador y el calificador actuales se recalcula la expectativa de cada
 * intento contra la foto del tenant y se recalifican las respuestas guardadas **solo con los chequeos deterministas**.
 * Lo que sigue sin evidencia queda marcado «necesita juez»; aquí no se llama a ningún modelo.
 *
 * El acuerdo se mide contra etiquetas humanas (`correct` / `wrong` / `ambiguous`), separado en lo que decide el
 * determinista y lo que queda para el juez. El criterio de R7 es ≥ 90 % de acuerdo antes de usar el juez para decidir.
 */
import type { CompiledSpec, TenantSnapshot } from '../types';
import { generateRehearsal, rehearsalCaseFor, type RehearsalCase } from './generate';
import { gradeCase, isPass, type RehearsalCheck, type RehearsalOutcome, type RehearsalToolCall } from './grade';

export const REGRADE_SCHEMA = 'business-spec/rehearsal-regrade@1';

/** Un intento guardado (forma de `RehearsalRunDetail.results` de la API). */
export interface StoredAttempt {
    caseKey: string;
    intentId: string;
    requirementIds: string[];
    itemId: string | null;
    language: string;
    expected: string;
    valueState: string | null;
    outcome: RehearsalOutcome;
    decidedBy: 'deterministic' | 'judge' | null;
    turns: { customer: string; agent: string | null }[];
}

export interface StoredRun { id: string; seed: string; attempt?: number; results: StoredAttempt[] }
export interface StoredMeasurement { seed?: string; results: { schema: string; tenantId?: string; runs: StoredRun[] }[] }
export interface StoredToolCalls { schema: string; runId: string; caseKey: string; toolCalls: RehearsalToolCall[] | null }

export type RegradeStatus = 'unchanged' | 'expectation_changed' | 'requirement_replaced' | 'case_missing' | 'error' | 'no_snapshot';

export interface RegradedAttempt {
    schema: string;
    runId: string;
    attempt: number | null;
    caseKey: string;
    intentId: string;
    status: RegradeStatus;
    /** La clave del caso existe en el banco que el generador actual arma con la misma semilla contra la foto. */
    inBank: boolean | null;
    before: { requirementId: string; expected: string; valueState: string | null; outcome: RehearsalOutcome; decidedBy: string | null };
    after: {
        caseKey: string; requirementId: string; expected: string; valueState: string | null;
        outcome: RehearsalOutcome; decidedBy: 'deterministic' | 'judge' | null; needsJudge: boolean; missClass: string | null;
        reason: string; checks: RehearsalCheck[]; paraphrase: string;
    } | null;
    /** Por qué no hay caso (intención o ítem ya no existen, ningún requisito responde). */
    skip?: string;
}

export interface RegradeSummary {
    attempts: number;
    byStatus: Record<string, number>;
    before: { deterministic: number; judge: number; error: number; pass: number; wrong: number };
    after: { deterministic: number; needsJudge: number; skipped: number; pass: number; wrong: number };
    /** Cambios de requisito esperado por intención (antes → después), con su número de intentos. */
    requirementChanges: { intentId: string; from: string; to: string; attempts: number }[];
    /** Cambios del código esperado con el mismo requisito (foco de `answer_fields` o cambio en la foto). */
    expectationChanges: { intentId: string; requirementId: string; from: string; to: string; attempts: number }[];
}

export interface RegradeReport {
    schema: typeof REGRADE_SCHEMA;
    specVersion: string;
    seed: string | null;
    summary: RegradeSummary;
    attempts: RegradedAttempt[];
}

/** `tenant_salon_qa_citas_<hex32>` → `salon-qa-citas` (el slug con que se exportan las fotos). */
export const slugOfSchema = (schema: string): string => schema.replace(/^tenant_/, '').replace(/_[0-9a-f]{32}$/, '').replace(/_/g, '-');

const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

export function regradeMeasurement(spec: CompiledSpec, input: StoredMeasurement, snapshots: Record<string, TenantSnapshot>, toolCalls: StoredToolCalls[] = []): RegradeReport {
    const calls = new Map(toolCalls.map(t => [`${t.schema}|${t.runId}|${t.caseKey}`, t.toolCalls ?? []]));
    const attempts: RegradedAttempt[] = [];
    const banks = new Map<string, Set<string>>();
    for (const tenant of input.results) {
        const snap = snapshots[slugOfSchema(tenant.schema)] ?? snapshots[tenant.schema];
        for (const run of tenant.runs) {
            const seed = run.seed ?? input.seed ?? 'default';
            const bankKey = `${tenant.schema}|${seed}`;
            if (snap && !banks.has(bankKey)) banks.set(bankKey, new Set(generateRehearsal(spec, snap, { seed }).cases.map(c => c.key)));
            for (const r of run.results) {
                const base = {
                    schema: tenant.schema, runId: run.id, attempt: run.attempt ?? null, caseKey: r.caseKey, intentId: r.intentId,
                    before: { requirementId: r.requirementIds[0], expected: r.expected, valueState: r.valueState, outcome: r.outcome, decidedBy: r.decidedBy },
                };
                if (!snap) { attempts.push({ ...base, status: 'no_snapshot', inBank: null, after: null }); continue; }
                if (r.outcome === 'error') { attempts.push({ ...base, status: 'error', inBank: banks.get(bankKey)!.has(r.caseKey), after: null }); continue; }
                const turns = r.turns.map(t => t.customer);
                const found = rehearsalCaseFor(spec, snap, { intentId: r.intentId, requirementId: r.requirementIds[0], itemId: r.itemId, language: r.language, turns });
                if (!found.case) { attempts.push({ ...base, status: 'case_missing', inBank: banks.get(bankKey)!.has(r.caseKey), after: null, skip: found.skip }); continue; }
                const c: RehearsalCase = found.case;
                const g = gradeCase(c, { replies: r.turns.map(t => t.agent ?? ''), toolCalls: calls.get(`${tenant.schema}|${run.id}|${r.caseKey}`) ?? [] }, null);
                const status: RegradeStatus = c.requirementIds[0] !== r.requirementIds[0] ? 'requirement_replaced'
                    : c.expected !== r.expected || c.valueState !== r.valueState ? 'expectation_changed' : 'unchanged';
                attempts.push({
                    ...base, status, inBank: banks.get(bankKey)!.has(c.key),
                    after: {
                        caseKey: c.key, requirementId: c.requirementIds[0], expected: c.expected, valueState: c.valueState,
                        outcome: g.outcome, decidedBy: g.decidedBy, needsJudge: g.needsJudge, missClass: g.missClass, reason: g.reason, checks: g.checks,
                        paraphrase: c.expectation.paraphrase,
                    },
                });
            }
        }
    }
    return { schema: REGRADE_SCHEMA, specVersion: spec.specVersion, seed: input.seed ?? null, summary: summarizeRegrade(attempts), attempts };
}

export function summarizeRegrade(attempts: readonly RegradedAttempt[]): RegradeSummary {
    const byStatus: Record<string, number> = {};
    const req = new Map<string, number>();
    const exp = new Map<string, number>();
    for (const a of attempts) {
        byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
        if (a.status === 'requirement_replaced' && a.after) count(req, `${a.intentId}|${a.before.requirementId}|${a.after.requirementId}`);
        if (a.status === 'expectation_changed' && a.after) count(exp, `${a.intentId}|${a.after.requirementId}|${a.before.expected}|${a.after.expected}`);
    }
    const before = { deterministic: 0, judge: 0, error: 0, pass: 0, wrong: 0 };
    const after = { deterministic: 0, needsJudge: 0, skipped: 0, pass: 0, wrong: 0 };
    for (const a of attempts) {
        if (a.before.outcome === 'error') before.error++;
        else if (a.before.decidedBy === 'judge') before.judge++;
        else if (a.before.decidedBy === 'deterministic') before.deterministic++;
        if (isPass(a.before.outcome)) before.pass++;
        if (a.before.outcome === 'wrong') before.wrong++;
        if (a.status === 'error') continue;
        if (!a.after) { after.skipped++; continue; }
        if (a.after.needsJudge) after.needsJudge++;
        else if (a.after.decidedBy === 'deterministic') {
            after.deterministic++;
            if (isPass(a.after.outcome)) after.pass++;
            else if (a.after.outcome === 'wrong') after.wrong++;
        }
    }
    const byIntent = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
    return {
        attempts: attempts.length, byStatus, before, after,
        requirementChanges: [...req].map(([k, n]) => { const [intentId, from, to] = k.split('|'); return { intentId, from, to, attempts: n }; }).sort((a, b) => byIntent(a.intentId, b.intentId)),
        expectationChanges: [...exp].map(([k, n]) => { const [intentId, requirementId, from, to] = k.split('|'); return { intentId, requirementId, from, to, attempts: n }; }).sort((a, b) => byIntent(a.intentId, b.intentId)),
    };
}

// ─────────────────────────── acuerdo con la revisión humana ───────────────────────────

export interface HumanLabel { id?: string; schema: string; runId: string; caseKey: string; intentId?: string; agent: 'correct' | 'wrong' | 'ambiguous'; note?: string }

/** Veredicto de una máquina sobre un intento: aprueba, falla, o lo deja al juez. */
export type MachineVerdict = 'pass' | 'fail' | 'judge';
export type HumanVerdict = HumanLabel['agent'];

export interface AgreementCell { human: HumanVerdict; machine: MachineVerdict; n: number }

export interface AgreementBlock {
    /** Etiquetas con veredicto humano claro (sin ambiguas) que este calificador decidió. */
    decided: number;
    agree: number;
    /** agree / decided; null si no decidió ninguno. */
    rate: number | null;
    /** decided / etiquetas claras. */
    coverage: number | null;
    matrix: AgreementCell[];
}

export interface AgreementReport {
    labels: number;
    matched: number;
    unmatched: string[];
    clear: number;
    ambiguous: number;
    /** Calificador recalificado (E1.1): solo deterministas; lo demás, «necesita juez». */
    regraded: { deterministic: AgreementBlock; overall: AgreementBlock };
    /** Calificador original de la medición (deterministas + juez de E1), para comparar. */
    original: { deterministic: AgreementBlock; judge: AgreementBlock; overall: AgreementBlock };
    /** Etiquetas en que el determinista recalificado discrepa del humano (para revisar marcadores). */
    disagreements: { id: string | null; caseKey: string; human: HumanVerdict; machine: MachineVerdict; reason: string }[];
}

const verdictOf = (outcome: RehearsalOutcome): MachineVerdict | null => (isPass(outcome) ? 'pass' : outcome === 'wrong' ? 'fail' : null);
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

function block(rows: { human: HumanVerdict; machine: MachineVerdict }[], clear: number): AgreementBlock {
    const cells = new Map<string, number>();
    for (const r of rows) count(cells, `${r.human}|${r.machine}`);
    const decided = rows.filter(r => r.human !== 'ambiguous' && r.machine !== 'judge');
    const agree = decided.filter(r => (r.human === 'correct') === (r.machine === 'pass')).length;
    const order: HumanVerdict[] = ['correct', 'wrong', 'ambiguous'];
    const morder: MachineVerdict[] = ['pass', 'fail', 'judge'];
    return {
        decided: decided.length, agree, rate: decided.length ? round4(agree / decided.length) : null, coverage: clear ? round4(decided.length / clear) : null,
        matrix: order.flatMap(h => morder.map(m => ({ human: h, machine: m, n: cells.get(`${h}|${m}`) ?? 0 }))),
    };
}

export function agreementReport(regraded: Pick<RegradeReport, 'attempts'>, labels: readonly HumanLabel[]): AgreementReport {
    const idx = new Map(regraded.attempts.map(a => [`${a.schema}|${a.runId}|${a.caseKey}`, a]));
    const rows: { label: HumanLabel; a: RegradedAttempt }[] = [];
    const unmatched: string[] = [];
    for (const l of labels) {
        const a = idx.get(`${l.schema}|${l.runId}|${l.caseKey}`);
        if (a) rows.push({ label: l, a }); else unmatched.push(l.id ?? l.caseKey);
    }
    const clear = rows.filter(r => r.label.agent !== 'ambiguous').length;
    const after = rows.map(r => ({
        human: r.label.agent,
        machine: (!r.a.after || r.a.after.needsJudge || !r.a.after.decidedBy ? 'judge' : verdictOf(r.a.after.outcome) ?? 'judge') as MachineVerdict,
        r,
    }));
    const before = rows.map(r => ({ human: r.label.agent, machine: (verdictOf(r.a.before.outcome) ?? 'judge') as MachineVerdict, by: r.a.before.decidedBy }));
    return {
        labels: labels.length, matched: rows.length, unmatched, clear, ambiguous: rows.length - clear,
        regraded: { deterministic: block(after.filter(x => x.machine !== 'judge'), clear), overall: block(after, clear) },
        original: {
            deterministic: block(before.filter(x => x.by === 'deterministic'), clear),
            judge: block(before.filter(x => x.by === 'judge'), clear),
            overall: block(before, clear),
        },
        disagreements: after.filter(x => x.human !== 'ambiguous' && x.machine !== 'judge' && (x.human === 'correct') !== (x.machine === 'pass'))
            .map(x => ({ id: x.r.label.id ?? null, caseKey: x.r.label.caseKey, human: x.human, machine: x.machine, reason: x.r.a.after?.reason ?? '' })),
    };
}

/** Matriz y tasas en texto (para la consola y el informe). */
export function renderAgreement(r: AgreementReport): string {
    const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)} %`);
    const table = (title: string, b: AgreementBlock) => {
        const get = (h: HumanVerdict, m: MachineVerdict) => b.matrix.find(c => c.human === h && c.machine === m)?.n ?? 0;
        return [
            `${title}: acuerdo ${b.agree}/${b.decided} = ${pct(b.rate)} · cobertura ${pct(b.coverage)} de ${r.clear} etiquetas claras`,
            '  humano \\ máquina   aprueba  falla  juez',
            ...(['correct', 'wrong', 'ambiguous'] as HumanVerdict[]).map(h => `  ${h.padEnd(18)} ${String(get(h, 'pass')).padStart(7)} ${String(get(h, 'fail')).padStart(6)} ${String(get(h, 'judge')).padStart(5)}`),
        ].join('\n');
    };
    return [
        `etiquetas: ${r.labels} (emparejadas ${r.matched}${r.unmatched.length ? `, sin intento: ${r.unmatched.join(', ')}` : ''}) · claras ${r.clear} · ambiguas ${r.ambiguous}`,
        '',
        table('Recalificado E1.1 · deterministas', r.regraded.deterministic),
        '',
        table('Recalificado E1.1 · todo (lo no decidido queda para el juez)', r.regraded.overall),
        '',
        table('Original E1 · deterministas', r.original.deterministic),
        '',
        table('Original E1 · juez', r.original.judge),
        '',
        table('Original E1 · todo', r.original.overall),
        ...(r.disagreements.length ? ['', 'Discrepancias del determinista recalificado:', ...r.disagreements.map(d => `  ${d.id ?? ''} ${d.caseKey}: humano ${d.human}, máquina ${d.machine} — ${d.reason.slice(0, 140)}`)] : []),
        '',
    ].join('\n');
}
