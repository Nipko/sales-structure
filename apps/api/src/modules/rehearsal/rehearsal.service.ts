/**
 * Ensayo antes de salir (C0 §1.4 C4, rebanada R7, ADR 0013): corre el banco del paquete por el agente real y guarda
 * cada caso calificado.
 *
 * - **Banco.** `generateRehearsal` (@parallext/business-spec) sobre la foto del tenant (SnapshotReader, solo lectura):
 *   ≤ 40 casos, sembrado, con la respuesta esperada de `qaTruth`. Repetir una ejecución (`repeatOf`) reutiliza su banco
 *   congelado tal cual: así la fase E mide pass^k sobre los mismos casos.
 * - **Ejecución.** Cada caso pasa por `AgentTestService.test` en modo vista previa: el mismo núcleo del turno que en
 *   producción, con una foto congelada del agente, herramientas de solo lectura (las de escritura quedan bloqueadas y
 *   «lo averiguo» corre en seco, ADR 0011), sin entregas por canal, sin notificaciones y **sin pasar por el control de
 *   salida** (ADR 0010: Agent Test y el ensayo no registran decisiones en `go_live_decisions`). El uso de LLM cuenta en
 *   la cuota del tenant como cualquier Agent Test.
 * - **Calificación.** `gradeCase`: chequeos deterministas primero; el juez de paráfrasis (RehearsalJudge) solo si no
 *   hubo evidencia, y nunca anula un fallo determinista.
 * - **Límites.** Una ejecución a la vez por tenant, `MAX_RUNS_PER_DAY` por día, ≤ 40 casos, 10 minutos de reloj
 *   (lo que falte queda sin correr y la ejecución termina `stopped`). Se guardan modelo, tokens y costo.
 *
 * Lo único que escribe son `rehearsal_runs` y `rehearsal_results`.
 */
import { ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
    generateRehearsal, gradeCase, passHatK, summarize, REHEARSAL_MAX_CASES,
    type RehearsalBank, type RehearsalCase, type RehearsalGrade, type RehearsalObservation, type RehearsalSummary, type RehearsalToolCall,
} from '@parallext/business-spec';
import { AgentTestService } from '../conversations/agent-test.service';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from '../readiness/readiness.service';
import { RehearsalJudge } from './rehearsal-judge';

export const REHEARSAL_COMPLETED_EVENT = 'rehearsal.completed';
/** Ensayos por tenant y día (cuota del dueño; el uso de LLM además cuenta en la cuota de mensajes de IA). */
export const MAX_RUNS_PER_DAY = 6;
/** Reloj de una ejecución (aceptación R7 #1: 40 casos en < 10 min). */
export const RUN_DEADLINE_MS = 10 * 60_000;
/** Una ejecución `running` sin terminar pasado este tiempo murió con su proceso (despliegue, reinicio). */
export const STALE_RUN_MS = 20 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RehearsalRunStatus = 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted';

export interface RehearsalStartInput {
    agentId?: string | null;
    seed?: string | null;
    maxCases?: number | null;
    languages?: string[] | null;
    /** Repite el banco congelado de esa ejecución (pass^k). */
    repeatOf?: string | null;
    requestedBy?: string | null;
    /**
     * Fase E: la medición interna (`scripts/rehearsal/measure.cjs`) no consume el cupo diario del dueño. El
     * controlador arma la entrada campo por campo y nunca lo pasa: solo existe para quien corre dentro del contenedor.
     */
    internalMeasurement?: boolean;
}

export interface RehearsalRunView {
    id: string;
    agentId: string | null;
    status: RehearsalRunStatus;
    seed: string;
    specVersion: string;
    snapshotHash: string;
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
    coverage?: RehearsalBank['coverage'];
}

export interface RehearsalResultView {
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
    outcome: RehearsalGrade['outcome'];
    missClass: RehearsalGrade['missClass'];
    decidedBy: RehearsalGrade['decidedBy'];
    reason: string | null;
    turns: { customer: string; agent: string }[];
    checks: RehearsalGrade['checks'];
    model: string | null;
    latencyMs: number | null;
}

export interface RehearsalRunDetail extends RehearsalRunView {
    results: RehearsalResultView[];
    /** Casos del banco aún sin resultado (progreso). */
    pending: number;
    /** pass^k del mismo banco congelado (todas las ejecuciones con este `bank_hash`), para la fase E. */
    passHatK: ReturnType<typeof passHatK> | null;
}

interface CaseRun { obs: RehearsalObservation; model: string | null; inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number }

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

@Injectable()
export class RehearsalService {
    private readonly logger = new Logger(RehearsalService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly readiness: ReadinessService,
        private readonly agentTest: AgentTestService,
        @Optional() private readonly judge?: RehearsalJudge,
        @Optional() private readonly events?: EventEmitter2,
    ) {}

    /** Reloj (las pruebas lo reemplazan). */
    protected now(): number {
        return Date.now();
    }

    // ─────────────────────────── lanzar ───────────────────────────

    /** Crea la ejecución (banco congelado) y la corre en segundo plano; devuelve la vista inicial enseguida. */
    async start(tenantId: string, input: RehearsalStartInput = {}): Promise<RehearsalRunView> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.markStale(schema);
        const [{ running, today }] = await this.sql<{ running: number; today: number }[]>(schema,
            `SELECT count(*) FILTER (WHERE status = 'running')::int AS running,
                    count(*) FILTER (WHERE started_at >= date_trunc('day', clock_timestamp()))::int AS today
               FROM rehearsal_runs`);
        if (running > 0) throw new ConflictException('rehearsal_running');
        if (today >= MAX_RUNS_PER_DAY && input.internalMeasurement !== true) throw new HttpException('rehearsal_quota_exceeded', HttpStatus.TOO_MANY_REQUESTS);
        const agentId = await this.resolveAgent(schema, input.agentId);

        let bank: RehearsalBank;
        let attempt = 1;
        let repeatOf: string | null = null;
        if (input.repeatOf) {
            if (!UUID.test(input.repeatOf)) throw new NotFoundException('rehearsal_run_not_found');
            const [prev] = await this.sql<{ bank: RehearsalBank; attempt: number; repeat_of: string | null; id: string }[]>(schema,
                'SELECT id, bank, attempt, repeat_of FROM rehearsal_runs WHERE id = $1::uuid', [input.repeatOf]);
            if (!prev) throw new NotFoundException('rehearsal_run_not_found');
            bank = prev.bank;
            repeatOf = prev.repeat_of ?? prev.id;
            const [{ attempts }] = await this.sql<{ attempts: number }[]>(schema,
                'SELECT count(*)::int AS attempts FROM rehearsal_runs WHERE bank_hash = $1', [bank.bankHash]);
            attempt = attempts + 1;
        } else {
            const snapshot = await this.readiness.readSnapshot(tenantId);
            bank = generateRehearsal(this.readiness.spec, snapshot, {
                seed: input.seed?.trim() || 'default',
                maxCases: Math.min(Number(input.maxCases) || REHEARSAL_MAX_CASES, REHEARSAL_MAX_CASES),
                languages: input.languages?.length ? input.languages : undefined,
            });
        }
        if (!bank.cases.length) throw new ConflictException('rehearsal_no_cases');

        const [row] = await this.sql<any[]>(schema,
            `INSERT INTO rehearsal_runs (agent_id, status, seed, spec_version, snapshot_hash, bank_hash, bank, repeat_of, attempt, case_count, requested_by)
             VALUES ($1::uuid, 'running', $2, $3, $4, $5, $6::jsonb, $7::uuid, $8, $9, $10::uuid)
             RETURNING *`,
            [agentId, bank.seed, bank.specVersion, bank.snapshotHash, bank.bankHash, JSON.stringify(bank), repeatOf, attempt, bank.cases.length,
                input.requestedBy && UUID.test(input.requestedBy) ? input.requestedBy : null]);
        const view = this.toRunView(row);
        void this.execute(tenantId, schema, view.id, agentId, bank).catch(error =>
            this.logger.error(`[rehearsal] ejecución ${view.id} falló fuera de control: ${(error as Error)?.message ?? error}`));
        return view;
    }

    /**
     * Corre los casos en orden, uno por uno (el tope de 40 y el reloj de 10 min acotan costo y tiempo). Un caso que
     * falla por cuota detiene la ejecución; cualquier otro error queda en el caso como `error` y se sigue.
     */
    async execute(tenantId: string, schema: string, runId: string, agentId: string, bank: RehearsalBank): Promise<void> {
        const started = this.now();
        let snapshot: AgentEvaluationSnapshot | null = null;
        let status: RehearsalRunStatus = 'completed';
        let error: string | null = null;
        try {
            snapshot = await this.agentTest.captureSnapshot(tenantId, agentId);
            for (const c of bank.cases) {
                if (this.now() - started > RUN_DEADLINE_MS) { status = 'stopped'; error = 'rehearsal_deadline'; break; }
                const run = await this.runCase(tenantId, agentId, c, snapshot);
                let grade = gradeCase(c, run.obs);
                let judgeTokens = 0;
                let judged = false;
                if (grade.needsJudge && this.judge?.available) {
                    const call = await this.judge.judge(tenantId, c, run.obs.replies, this.agentTest.snapshotSourceAuthority(snapshot));
                    judged = true;
                    if (call) { grade = gradeCase(c, run.obs, call.verdict); judgeTokens = call.tokens; }
                }
                await this.storeResult(schema, runId, c, run, grade, judged, judgeTokens);
                if (run.obs.error === 'ai_message_quota_exceeded') { status = 'stopped'; error = 'ai_message_quota_exceeded'; break; }
            }
        } catch (e) {
            status = 'failed';
            error = String((e as Error)?.message ?? e).slice(0, 500);
            this.logger.warn(`[rehearsal] ejecución ${runId} falló: ${error}`);
        } finally {
            if (snapshot) await this.agentTest.releaseSnapshot(snapshot);
        }
        const summary = await this.finish(schema, runId, status, error);
        this.events?.emit(REHEARSAL_COMPLETED_EVENT, { tenantId, runId, status, summary });
    }

    /** Un caso por Agent Test en vista previa (sin `evalMode`, sin namespace: nada se escribe ni se entrega). */
    private async runCase(tenantId: string, agentId: string, c: RehearsalCase, snapshot: AgentEvaluationSnapshot): Promise<CaseRun> {
        const replies: string[] = [];
        const toolCalls: RehearsalToolCall[] = [];
        const history: { role: 'user' | 'assistant'; content: string }[] = [];
        const models = new Set<string>();
        let inputTokens = 0, outputTokens = 0, costUsd = 0;
        let runtimeSessionId: string | undefined;
        const t0 = this.now();
        try {
            for (const [i, message] of c.turns.entries()) {
                const res = await this.agentTest.test(tenantId, agentId,
                    { message, conversationHistory: [...history], ...(runtimeSessionId ? { runtimeSessionId } : {}) },
                    { agentSnapshot: snapshot, disableTools: false });
                const debug = res?.debug;
                if (debug?.runtimeError) throw new Error(`agent_runtime_failed:${debug.runtimeError}`);
                const reply = String(res?.reply ?? '');
                replies.push(reply);
                runtimeSessionId = debug?.runtimeSessionId ?? runtimeSessionId;
                for (const call of debug?.toolCalls ?? []) toolCalls.push({ turn: i + 1, name: call.name, result: call.result });
                if (debug?.model) models.add(String(debug.model));
                inputTokens += num(debug?.tokens?.input);
                outputTokens += num(debug?.tokens?.output);
                costUsd += num(debug?.cost);
                history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
            }
            return { obs: { replies, toolCalls }, model: [...models].sort().join('+') || null, inputTokens, outputTokens, costUsd, latencyMs: this.now() - t0 };
        } catch (e) {
            const quota = e instanceof HttpException && e.getStatus() === HttpStatus.TOO_MANY_REQUESTS;
            const message = quota ? 'ai_message_quota_exceeded' : String((e as Error)?.message ?? e).slice(0, 300);
            return { obs: { replies, toolCalls, error: message }, model: [...models].sort().join('+') || null, inputTokens, outputTokens, costUsd, latencyMs: this.now() - t0 };
        }
    }

    private async storeResult(schema: string, runId: string, c: RehearsalCase, run: CaseRun, grade: RehearsalGrade, judged: boolean, judgeTokens: number): Promise<void> {
        const turns = c.turns.map((customer, i) => ({ customer, agent: (run.obs.replies[i] ?? '').slice(0, 8_000) }));
        const judgeCheck = grade.checks.find(k => k.id === 'judge');
        await this.sql(schema,
            `INSERT INTO rehearsal_results (run_id, case_key, intent_id, requirement_ids, item_id, language, expected, value_state, outcome,
                    miss_class, decided_by, reason, turns, tool_calls, checks, judge, model, input_tokens, output_tokens, latency_ms)
             VALUES ($1::uuid, $2, $3, $4::text[], $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18, $19, $20)
             ON CONFLICT (run_id, case_key) DO NOTHING`,
            [runId, c.key, c.intentId, c.requirementIds, c.itemId, c.language, c.expected, c.valueState, grade.outcome,
                grade.missClass, grade.decidedBy, (run.obs.error ?? grade.reason).slice(0, 2_000), JSON.stringify(turns),
                JSON.stringify(run.obs.toolCalls.map(t => ({ turn: t.turn, name: t.name }))), JSON.stringify(grade.checks),
                judged ? JSON.stringify({ called: true, tokens: judgeTokens, verdict: judgeCheck ? { ok: judgeCheck.ok, detail: judgeCheck.detail } : null }) : null,
                run.model, run.inputTokens, run.outputTokens, run.latencyMs]);
        await this.sql(schema,
            `UPDATE rehearsal_runs SET completed_count = completed_count + 1,
                    input_tokens = input_tokens + $2, output_tokens = output_tokens + $3, cost_usd = cost_usd + $4,
                    judge_calls = judge_calls + $5, judge_tokens = judge_tokens + $6,
                    models = CASE WHEN $7::text IS NULL OR $7::text = ANY(models) THEN models ELSE array_append(models, $7::text) END
              WHERE id = $1::uuid`,
            [runId, run.inputTokens, run.outputTokens, run.costUsd, judged ? 1 : 0, judgeTokens, run.model]);
    }

    private async finish(schema: string, runId: string, status: RehearsalRunStatus, error: string | null): Promise<RehearsalSummary> {
        const rows = await this.sql<{ outcome: RehearsalGrade['outcome'] }[]>(schema, 'SELECT outcome FROM rehearsal_results WHERE run_id = $1::uuid', [runId]);
        const summary = summarize(rows);
        await this.sql(schema,
            `UPDATE rehearsal_runs SET status = $2, error = $3, summary = $4::jsonb, pass_rate = $5, completed_at = clock_timestamp()
              WHERE id = $1::uuid AND status = 'running'`,
            [runId, status, error, JSON.stringify(summary), summary.passRate]);
        return summary;
    }

    // ─────────────────────────── leer ───────────────────────────

    async list(tenantId: string, limit = 20): Promise<RehearsalRunView[]> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!await this.tablesExist(schema)) return [];
        await this.markStale(schema);
        const rows = await this.sql<any[]>(schema,
            `SELECT ${RUN_COLUMNS} FROM rehearsal_runs ORDER BY started_at DESC LIMIT $1`, [Math.min(Math.max(1, limit), 100)]);
        return rows.map(r => this.toRunView(r));
    }

    async get(tenantId: string, runId: string): Promise<RehearsalRunDetail> {
        if (!UUID.test(runId)) throw new NotFoundException('rehearsal_run_not_found');
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!await this.tablesExist(schema)) throw new NotFoundException('rehearsal_run_not_found');
        await this.markStale(schema);
        const [row] = await this.sql<any[]>(schema, `SELECT ${RUN_COLUMNS}, bank FROM rehearsal_runs WHERE id = $1::uuid`, [runId]);
        if (!row) throw new NotFoundException('rehearsal_run_not_found');
        const bank = row.bank as RehearsalBank;
        const byKey = new Map(bank.cases.map(c => [c.key, c]));
        const results = await this.sql<any[]>(schema,
            'SELECT * FROM rehearsal_results WHERE run_id = $1::uuid ORDER BY created_at, case_key', [runId]);
        const attempts = await this.sql<{ case_key: string; outcome: RehearsalGrade['outcome'] }[]>(schema,
            `SELECT r.case_key, r.outcome FROM rehearsal_results r JOIN rehearsal_runs u ON u.id = r.run_id
              WHERE u.bank_hash = $1 ORDER BY u.started_at`, [bank.bankHash]);
        const runs = await this.sql<{ n: number }[]>(schema, 'SELECT count(*)::int AS n FROM rehearsal_runs WHERE bank_hash = $1', [bank.bankHash]);
        const k = Number(runs[0]?.n ?? 1);
        return {
            ...this.toRunView(row),
            coverage: bank.coverage,
            results: results.map(r => this.toResultView(r, byKey.get(r.case_key))),
            pending: Math.max(0, bank.cases.length - results.length),
            passHatK: k > 1 ? passHatK(attempts.map(a => ({ caseKey: a.case_key, outcome: a.outcome })), k) : null,
        };
    }

    // ─────────────────────────── apoyo ───────────────────────────

    /** El agente del ensayo: el pedido (si existe) o el activo por defecto. Lectura pura: nunca crea un agente. */
    private async resolveAgent(schema: string, agentId?: string | null): Promise<string> {
        if (agentId && !UUID.test(agentId)) throw new NotFoundException('agent_not_found');
        const rows = await this.sql<{ id: string }[]>(schema,
            agentId ? 'SELECT id FROM agent_personas WHERE id = $1::uuid'
                : 'SELECT id FROM agent_personas WHERE is_active = true ORDER BY is_default DESC, created_at ASC LIMIT 1',
            agentId ? [agentId] : []);
        if (!rows[0]) throw new ConflictException(agentId ? 'agent_not_found' : 'rehearsal_no_agent');
        return rows[0].id;
    }

    /** Una ejecución que quedó `running` tras un reinicio no va a terminar: queda `interrupted` con lo que alcanzó a correr. */
    private async markStale(schema: string): Promise<void> {
        await this.sql(schema,
            `UPDATE rehearsal_runs SET status = 'interrupted', error = 'process_restarted', completed_at = clock_timestamp()
              WHERE status = 'running' AND started_at < clock_timestamp() - ($1 || ' milliseconds')::interval`, [String(STALE_RUN_MS)]);
    }

    private async tablesExist(schema: string): Promise<boolean> {
        const [row] = await this.sql<{ ok: boolean }[]>(schema, `SELECT to_regclass('rehearsal_runs') IS NOT NULL AS ok`);
        return row?.ok === true;
    }

    private sql<T = unknown[]>(schema: string, query: string, params: unknown[] = []): Promise<T> {
        return this.prisma.executeInTenantSchema<T>(schema, query, params as any[]);
    }

    private toRunView(r: any): RehearsalRunView {
        return {
            id: r.id, agentId: r.agent_id ?? null, status: r.status, seed: r.seed, specVersion: r.spec_version, snapshotHash: r.snapshot_hash,
            bankHash: r.bank_hash, repeatOf: r.repeat_of ?? null, attempt: num(r.attempt), caseCount: num(r.case_count), completedCount: num(r.completed_count),
            summary: r.summary ?? null, passRate: r.pass_rate === null || r.pass_rate === undefined ? null : Number(r.pass_rate),
            models: r.models ?? [], inputTokens: num(r.input_tokens), outputTokens: num(r.output_tokens), judgeCalls: num(r.judge_calls),
            judgeTokens: num(r.judge_tokens), costUsd: num(r.cost_usd), error: r.error ?? null, startedAt: iso(r.started_at), completedAt: iso(r.completed_at),
        };
    }

    private toResultView(r: any, c: RehearsalCase | undefined): RehearsalResultView {
        return {
            caseKey: r.case_key, intentId: r.intent_id, intentTitle: c?.intentTitle ?? null, requirementIds: r.requirement_ids ?? [],
            requirementTitle: c?.requirementTitle ?? null, uiTarget: c?.uiTarget ?? null, itemId: r.item_id ?? null, itemName: c?.itemName ?? null,
            language: r.language, expected: r.expected, valueState: r.value_state ?? null, behavior: c?.truth.behavior ?? null,
            outcome: r.outcome, missClass: r.miss_class ?? null, decidedBy: r.decided_by ?? null, reason: r.reason ?? null,
            turns: r.turns ?? [], checks: r.checks ?? [], model: r.model ?? null, latencyMs: r.latency_ms ?? null,
        };
    }
}

const RUN_COLUMNS = `id, agent_id, status, seed, spec_version, snapshot_hash, bank_hash, repeat_of, attempt, case_count, completed_count,
    summary, pass_rate, models, input_tokens, output_tokens, judge_calls, judge_tokens, cost_usd, error, started_at, completed_at`;
