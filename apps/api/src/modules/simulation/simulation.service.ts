import { randomUUID } from 'crypto';
import { assertSimulationReplayRun, captureSimulationReplays, registerSimulationReplayNamespace, isReplayDefinition, scenarioDefinition, SimulationReplayUnavailable, withSimulationReplayRun, type ReplayAuthority } from './simulation-replay-authority';
import { retireSimulationReplayRuns, type SimulationReplayQuery } from './simulation-replay-retention';
import { bindCanonicalEvalFixtures } from './eval-canonical-fixtures';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { PersonaService } from '../persona/persona.service';
import { QualityService, JudgeResult } from '../quality/quality.service';
import { AgentTestService } from '../conversations/agent-test.service';
import { CONVERSATIONAL_CHANNELS } from '@parallext/shared';
import { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { EvalService, EvalSandboxSession } from './eval.service';
import { auditTurnClaim } from '../../common/utils/outcome-claim.util';
import type { LLMSourceAuthority } from '../ai/interfaces/llm-source-authority';

export const SIMULATION_QUEUE = 'agent-simulation';
export const AGENT_SIMULATION_COMPLETED_EVENT = 'agent.simulation.completed';
export const AGENT_SIMULATION_FAILED_EVENT = 'agent.simulation.failed';

export interface SimulationJob {
    tenantId: string;
    runId: string;
}

export interface StartSimulationInput {
    agentId?: string;
    channelType?: string;
    scenarioSource: 'synthetic' | 'replay';
    count?: number;
    vertical?: string;
    /** When set, reuse that run's scenarios and compare results against it (regression). */
    baselineRunId?: string;
    createdBy?: string;
}

/** A scenario definition — the customer side of a simulated conversation. */
interface ScenarioDef {
    key: string;
    title: string;
    /** Synthetic only: a short description of the simulated customer. */
    personaDescription?: string;
    goal: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    language: string;
    source: 'synthetic' | 'replay';
    /** First message the customer sends. */
    openingMessage: string;
    /** Replay only: the ordered real inbound customer messages. */
    replayMessages?: string[];
    replaySource?: {version: 1; sourceId: string; originRunId: string};
}

interface ScenarioResult extends ScenarioDef {
    transcript: Array<{ role: 'customer' | 'agent'; content: string }>;
    judge: JudgeResult | null;
    turns: number;
    latencyMs: number;
    error?: string;
    /**
     * Turns where the agent told the customer an action was done that the
     * backend never performed. A scenario can score well on tone and still
     * contain one of these — it is the most damaging thing the agent can do,
     * so it is reported separately from the judge's score.
     */
    falseClaims?: Array<{ turn: number; reply: string }>;
}

type ScoredScenarioResult = ScenarioResult & { judge: JudgeResult; error?: undefined };

function isScoredScenario(result: ScenarioResult): result is ScoredScenarioResult {
    return !!result && !result.error && Number.isFinite(result.judge?.overall);
}

const MAX_TURNS = 6; // synthetic: customer/agent exchanges per scenario
const MAX_REPLAY_MESSAGES = 8;
const SCENARIO_CONCURRENCY = 4;
const MAX_COUNT = 100;
const REGRESSION_THRESHOLD = 1.0; // overall-score drop to flag as regression

@Injectable()
export class SimulationService {
    private readonly logger = new Logger(SimulationService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly llmRouter: LLMRouterService,
        private readonly personaService: PersonaService,
        private readonly qualityService: QualityService,
        private readonly agentTest: AgentTestService,
        @InjectQueue(SIMULATION_QUEUE) private readonly queue: Queue<SimulationJob>,
        private readonly eventEmitter: EventEmitter2,
        @Optional() private readonly evals?: EvalService,
    ) {}

    // ---------------------------------------------------------------------
    // Table bootstrap
    // ---------------------------------------------------------------------
    async ensureTables(schemaName: string): Promise<void> {
        const cacheKey = `simulation_cols:v4:${schemaName}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE TABLE IF NOT EXISTS simulation_runs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                agent_id UUID,
                channel_type VARCHAR(40) DEFAULT 'whatsapp',
                persona_version INTEGER,
                persona_snapshot JSONB,
                scenario_source VARCHAR(20) NOT NULL DEFAULT 'synthetic',
                vertical VARCHAR(50),
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                scenario_count INTEGER DEFAULT 0,
                avg_score NUMERIC,
                resolved_rate NUMERIC,
                results JSONB DEFAULT '[]'::jsonb,
                summary JSONB,
                baseline_run_id UUID,
                error TEXT,
                created_by VARCHAR(120),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                completed_at TIMESTAMPTZ
            )`,
            [],
        );
        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE INDEX IF NOT EXISTS idx_simruns_created ON simulation_runs(created_at)`,
            [],
        );
        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE INDEX IF NOT EXISTS idx_simruns_agent ON simulation_runs(agent_id)`,
            [],
        );

        await this.prisma.executeInTenantSchema(schemaName, `ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS scenario_definitions JSONB`);
        await this.prisma.executeInTenantSchema(schemaName, `ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS evaluation_snapshot JSONB`);
        await this.prisma.executeInTenantSchema(schemaName, 'ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS replay_authority JSONB');
        await this.prisma.executeInTenantSchema(schemaName, 'ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ');
        await this.prisma.executeInTenantSchema(schemaName, 'ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS replay_namespace_leases JSONB');
        const retiredSnapshots: AgentEvaluationSnapshot[] = [];
        await this.prisma.transactionInTenantSchema(schemaName, async query => {
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', ['agent-privacy:' + schemaName]);
            await retireSimulationReplayRuns(query, {legacy:true,retiredSnapshots});
        });
        for (const snapshot of retiredSnapshots) await this.agentTest.releaseSnapshot(snapshot);
        await this.redis.set(cacheKey, '1', 86400);
    }

    // ---------------------------------------------------------------------
    // Public API (called from controller)
    // ---------------------------------------------------------------------

    /** Create a run row (status=pending) and enqueue the background job. */
    async startRun(tenantId: string, input: StartSimulationInput): Promise<{ runId: string }> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new BadRequestException('Tenant not found');
        await this.ensureTables(schemaName);

        // Resolve agent (must exist in agent_personas).
        const agentId = await this.resolveAgentId(tenantId, input.agentId);
        const channelType = input.channelType || 'web_widget';
        if (!CONVERSATIONAL_CHANNELS.includes(channelType as any)) throw new BadRequestException('Unsupported conversational channel');
        const agent = await this.personaService.getAgent(tenantId, agentId);
        if (!agent) throw new BadRequestException('Agent not found');
        const snapshot = await this.agentTest.captureSnapshot(tenantId, agentId);
        const source = input.scenarioSource === 'replay' ? 'replay' : 'synthetic';

        const requestedCount = Math.min(Math.max(Number(input.count) || 50, 1), MAX_COUNT);
        const runId = randomUUID();
        let persistenceAttempted = false;
        try {
        await this.agentTest.assertSnapshotExecutable(snapshot, tenantId, agentId);
        // Once persistence is attempted, a failed acknowledgement or an empty
        // recovery read cannot prove that COMMIT will never become visible.
        // Keep the bounded reference for the durable owner or expiry cleanup.
        persistenceAttempted = true;
        await this.prisma.transactionInTenantSchema(schemaName, async query => {
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', ['agent-privacy:' + schemaName]);
            let scenarios: ScenarioDef[] | null = null, authorities: ReplayAuthority[] = [];
            if (input.baselineRunId) {
                const [baseline] = await query<any[]>('SELECT * FROM simulation_runs WHERE id=$1::uuid',[input.baselineRunId]);
                await assertSimulationReplayRun(query,baseline,true);
                if (baseline.agent_id!==agentId || baseline.channel_type!==channelType) throw new SimulationReplayUnavailable();
                scenarios=(baseline.results || []).map(scenarioDefinition);
                if (!scenarios?.length) throw new BadRequestException('simulation_baseline_scenarios_required');
                authorities=baseline.replay_authority || [];
            } else if (source==='replay') {
                const captured=await this.buildReplayScenarios(query,runId,agentId,channelType,snapshot.config.language || 'es-CO',input.createdBy || '',requestedCount);
                scenarios=captured.scenarios; authorities=captured.authorities;
            }
            const [run]=await query<any[]>(`INSERT INTO simulation_runs
                (id,agent_id,channel_type,scenario_source,vertical,status,scenario_count,baseline_run_id,created_by,
                 persona_version,persona_snapshot,evaluation_snapshot,scenario_definitions,replay_authority)
                VALUES ($1::uuid,$2::uuid,$3,$4,$5,'pending',$6,$7::uuid,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb) RETURNING *`,
                [runId,agentId,channelType,source,input.vertical || null,scenarios?.length || requestedCount,input.baselineRunId || null,
                 input.createdBy || null,snapshot.version,JSON.stringify(snapshot.config),JSON.stringify(snapshot),
                 JSON.stringify(scenarios),JSON.stringify(authorities)]);
            await assertSimulationReplayRun(query,run,true);
        });

        try { await this.queue.add(
            'run',
            { tenantId, runId },
            {
                jobId: `sim-${runId}`,
                attempts: 3, // Completed scenario checkpoints are reused on retry.
                backoff: { type: 'exponential', delay: 15_000 },
                removeOnComplete: true,
                removeOnFail: 50,
            },
        );

        } catch (error: any) {
            await this.prisma.executeInTenantSchema(schemaName, `UPDATE simulation_runs SET status = 'failed', error = $2 WHERE id = $1::uuid AND status='pending'`, [runId, 'simulation_enqueue_failed']);
            throw error;
        }
        this.logger.log(`[Sim] Enqueued run ${runId} (tenant=${tenantId}, agent=${agentId}, source=${source})`);
        return { runId };
        } catch (error) {
            if (!persistenceAttempted) await this.agentTest.releaseSnapshot(snapshot);
            throw error;
        }
    }

    async listRuns(tenantId: string, limit = 20): Promise<any[]> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            'SELECT id FROM simulation_runs ORDER BY created_at DESC LIMIT $1',[Math.min(limit,100)]);
        const results=[];
        for (const row of rows || []) { const run=await this.readRun(schemaName,row.id); if(run)results.push(this.mapRunSummary(run)); }
        return results;
    }

    async getRun(tenantId: string, runId: string): Promise<any | null> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const r=await this.readRun(schemaName,runId);
        return r ? {...this.mapRunSummary(r),personaVersion:r.persona_version,results:Array.isArray(r.results)?r.results:[]} : null;
    }

    /** Withdraw evaluative permission and every baseline copy; this never changes learning releases. */
    async retireRun(tenantId:string,runId:string):Promise<{retired:boolean}> {
        const schemaName=await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const retiredSnapshots: AgentEvaluationSnapshot[] = [];
        await this.prisma.transactionInTenantSchema(schemaName,async query=>{
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',['agent-privacy:'+schemaName]);
            await retireSimulationReplayRuns(query,{runIds:[runId],retiredSnapshots});
        });
        for (const snapshot of retiredSnapshots) await this.agentTest.releaseSnapshot(snapshot);
        return {retired:true};
    }

    private async readRun(schemaName: string, runId: string): Promise<any | null> {
        try { return await withSimulationReplayRun(this.prisma,schemaName,runId,async(_query,run)=>run,{commit:true}); }
        catch(error) {
            if (!(error instanceof SimulationReplayUnavailable)) throw error;
            const rows=await this.prisma.executeInTenantSchema<any[]>(schemaName,
                'SELECT id,agent_id,channel_type,scenario_source,status,created_at,completed_at FROM simulation_runs WHERE id=$1::uuid',[runId]);
            return rows[0] ? {...rows[0],status:'retired',results:[],error:'simulation_replay_source_unavailable'} : null;
        }
    }

    // ---------------------------------------------------------------------
    // Background execution (called from processor)
    // ---------------------------------------------------------------------
    async executeRun(tenantId: string, runId: string): Promise<void> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);

        const runRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM simulation_runs WHERE id = $1::uuid`,
            [runId],
        );
        const run = runRows?.[0];
        if (!run) {
            this.logger.warn(`[Sim] Run ${runId} not found`);
            return;
        }

        if (run.status === 'completed' || run.status === 'retired') {
            await this.agentTest.releaseSnapshot(run.evaluation_snapshot);
            return;
        }
        try {
            const agentId: string = run.agent_id;
            const channelType: string = run.channel_type || 'web_widget';
            if (!(CONVERSATIONAL_CHANNELS as readonly string[]).includes(channelType)) throw new Error('unsupported_conversational_channel');
            const snapshot: AgentEvaluationSnapshot = run.evaluation_snapshot;
            await this.agentTest.assertSnapshotExecutable(snapshot, tenantId, agentId);
            const personaVersion = snapshot.version;
            const personaSnapshot = structuredClone(snapshot.config);

            // 1. Build scenario set. (scenario_count holds the requested count until
            // the run completes, when it is overwritten with the actual scenario count.)
            const requestedCount = Math.min(Math.max(Number(run.scenario_count) || 50, 1), MAX_COUNT);
            const baselineRunId: string | null = run.baseline_run_id || null;
            let scenarios: ScenarioDef[];
            if (Array.isArray(run.scenario_definitions) && run.scenario_definitions.length) {
                scenarios = await withSimulationReplayRun(this.prisma,schemaName,runId,async(_query,current)=>current.scenario_definitions);
            } else if (baselineRunId) {
                scenarios = await this.loadScenariosFromRun(schemaName, baselineRunId);
                if (!scenarios.length) throw new Error('Baseline run has no reusable scenarios');
            } else if (run.scenario_source === 'replay') {
                throw new SimulationReplayUnavailable(); // Historical jobs never acquire new source authority implicitly.
            } else {
                scenarios = await this.generateSyntheticScenarios(
                    tenantId,
                    run.vertical || personaSnapshot.industry || null,
                    requestedCount || 50,
                    this.agentTest.snapshotSourceAuthority(snapshot),
                );
            }
            if (!scenarios.length) throw new Error('Simulation produced no scenarios');
            await this.agentTest.assertSnapshotExecutable(snapshot);

            await withSimulationReplayRun(this.prisma,schemaName,runId,async(query,current)=>{
                current.scenario_definitions=scenarios;
                await assertSimulationReplayRun(query,current,true);
                await query(`UPDATE simulation_runs SET status='running',scenario_count=$2,persona_version=$3,
                    persona_snapshot=$4::jsonb,scenario_definitions=$5::jsonb,error=NULL WHERE id=$1::uuid AND status<>'retired'`,
                    [runId,scenarios.length,personaVersion,JSON.stringify(personaSnapshot),JSON.stringify(scenarios)]);
            },{commit:true});

            // 2. Run scenarios with bounded concurrency.
            const checkpoint = async (results: ScenarioResult[]) => {
                const lastResults = results.filter(Boolean);
                await withSimulationReplayRun(this.prisma,schemaName,runId,async(query,current)=>{
                    current.results=lastResults;
                    await assertSimulationReplayRun(query,current,true);
                    await query('UPDATE simulation_runs SET results=$2::jsonb WHERE id=$1::uuid AND status<>\'retired\'', [runId,JSON.stringify(lastResults)]);
                },{commit:true});
            };
            const runBatch = (session?: EvalSandboxSession) => this.runScenariosConcurrently(tenantId, agentId, channelType, scenarios, snapshot, session, run.results || [], checkpoint, {schemaName,runId});
            if (!this.evals) throw new Error('simulation_sandbox_unavailable');
            const results = await this.evals.withSandboxSession(tenantId, runBatch);
            const scored = results.filter(isScoredScenario);


            // 3. Aggregate + regression diff.
            await this.agentTest.assertSnapshotExecutable(snapshot, tenantId, agentId);
            const summary = await this.buildSummary(schemaName, results, baselineRunId);
            summary.agentRevision = { version: snapshot.version, configHash: snapshot.configHash, capturedAt: snapshot.capturedAt,
                dependencyRevision: snapshot.manifest!.revision, strategy: snapshot.manifest!.strategy, limitations: snapshot.manifest!.limitations };
            summary.scenarioSetHash = revisionHash(scenarios);
            summary.channelType = channelType;
            summary.executionSurface = 'audited_tool_sandbox';

            const avgScore = scored.length
                ? Math.round((scored.reduce((s, r) => s + r.judge.overall, 0) / scored.length) * 100) / 100
                : 0;
            const resolvedRate = scored.length
                ? Math.round((scored.filter((r) => r.judge?.resolved).length / results.length) * 10000) / 100
                : 0;

            if (!scored.length) throw new Error('Simulation produced no scorable scenarios');
            if (scored.length !== results.length) throw new Error('Simulation has unscorable scenarios');
            await withSimulationReplayRun(this.prisma,schemaName,runId,async(query,current)=>{
                current.results=results;
                await assertSimulationReplayRun(query,current,true);
                await query(`UPDATE simulation_runs SET status='completed',results=$2::jsonb,summary=$3::jsonb,
                    avg_score=$4,resolved_rate=$5,completed_at=NOW() WHERE id=$1::uuid AND status<>'retired'`,
                    [runId,JSON.stringify(results),JSON.stringify(summary),avgScore,resolvedRate]);
            },{commit:true});

            await this.agentTest.releaseSnapshot(snapshot);
            this.logger.log(
                `[Sim] Run ${runId} completed: ${scored.length}/${results.length} scored, avg=${avgScore}, resolved=${resolvedRate}%`,
            );
            this.emitRunEvent(AGENT_SIMULATION_COMPLETED_EVENT, tenantId, agentId, runId, 'completed');
        } catch (err: any) {
            this.logger.error(`[Sim] Run ${runId} failed`);
            const failed = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `UPDATE simulation_runs SET status = 'failed', error = $2, completed_at = NOW()
                    WHERE id = $1::uuid AND status NOT IN ('retired','completed') RETURNING id`,
                [runId, 'simulation_execution_failed'],
            );
            // A commit acknowledgement can be lost after completion persisted.
            // The retry reads that terminal row and releases its reference.
            if (failed?.length) this.emitRunEvent(AGENT_SIMULATION_FAILED_EVENT, tenantId, run.agent_id, runId, 'failed');
            if (err instanceof SimulationReplayUnavailable) throw err;
            if (run.scenario_source==='replay' || run.replay_authority?.length) throw new Error('simulation_execution_failed');
            throw err;
        }
    }

    private emitRunEvent(
        event: typeof AGENT_SIMULATION_COMPLETED_EVENT | typeof AGENT_SIMULATION_FAILED_EVENT,
        tenantId: string,
        agentId: string,
        runId: string,
        status: 'completed' | 'failed',
    ): void {
        try {
            this.eventEmitter.emit(event, { tenantId, agentId, runId, status });
        } catch (e: any) {
            this.logger.warn(`[Sim] could not emit ${event}: ${e.message}`);
        }
    }

    // ---------------------------------------------------------------------
    // Scenario sources
    // ---------------------------------------------------------------------

    /** Capture once under the requesting actor's tenant authorization and privacy fence. */
    private buildReplayScenarios(query: SimulationReplayQuery,runId:string,agentId:string,channelType:string,
        language:string,actor:string,count:number) {
        return captureSimulationReplays(query,{runId,agentId,channelType,language,actor,count});
    }

    /** LLM generates synthetic customer personas + goals for the tenant's vertical. */
    private async generateSyntheticScenarios(
        tenantId: string,
        vertical: string | null,
        count: number,
        withSourceAuthority: LLMSourceAuthority,
    ): Promise<ScenarioDef[]> {
        if (!withSourceAuthority) throw new Error('evaluation_source_authority_required');
        const n = Math.min(Math.max(count, 1), MAX_COUNT);
        const verticalLine = vertical
            ? `El negocio pertenece a la industria/vertical: "${vertical}".`
            : 'La industria no está especificada; usa escenarios genéricos de ventas y soporte.';

        const systemPrompt = `Eres un diseñador de pruebas (QA) para agentes conversacionales de ventas y soporte en Latinoamérica.
${verticalLine}
Genera ${n} escenarios de clientes sintéticos DIVERSOS para poner a prueba el agente antes de salir a producción.
Incluye una mezcla de dificultades: clientes fáciles, clientes con dudas, clientes molestos/escépticos, clientes que comparan precios, clientes que quieren agendar/comprar, y casos límite.
Devuelve ÚNICAMENTE un array JSON, sin texto adicional, con este formato exacto:
[
  {
    "title": "título corto del escenario",
    "personaDescription": "descripción breve del cliente (quién es, su contexto, su estado de ánimo)",
    "goal": "qué quiere lograr el cliente en la conversación",
    "difficulty": "easy" | "medium" | "hard",
    "openingMessage": "el primer mensaje que el cliente escribiría por WhatsApp, en español natural y coloquial"
  }
]
Los mensajes deben sonar como personas reales de Latinoamérica escribiendo por WhatsApp (informal, breve). Usa español.`;

        let raw = '';
        try {
            const res = await this.llmRouter.execute({
                task: 'conversation',
                allowedTiers: ['tier_2_standard', 'tier_3_efficient'],
                messages: [{ role: 'user', content: `Genera ${n} escenarios.` }],
                systemPrompt,
                temperature: 0.8,
                // El presupuesto SIGUE a la cantidad pedida. Estaba fijo en 3000
                // mientras el pedido por defecto es 50 escenarios (~130 tokens
                // cada uno = ~6500): la respuesta se cortaba cerca del 25, el
                // array quedaba sin cerrar y el parseo devolvía vacío. Con los
                // valores por defecto la simulación no podía terminar NUNCA.
                maxTokens: Math.min(8000, 800 + n * 160),
                tenantId,
                executionContext: AGENT_TEST_EXECUTION_CONTEXT,
                withSourceAuthority,
            });
            raw = res.content || '';
        } catch (err: any) {
            this.logger.error(`[Sim] Scenario generation failed: ${err.message}`);
            throw new Error('No se pudieron generar escenarios sintéticos');
        }

        const parsed = this.safeJsonArray(raw);
        const scenarios: ScenarioDef[] = parsed.slice(0, n).map((p: any, idx: number) => ({
            key: `synthetic:${idx}`,
            title: String(p.title || `Escenario ${idx + 1}`).slice(0, 120),
            personaDescription: p.personaDescription ? String(p.personaDescription).slice(0, 500) : undefined,
            goal: String(p.goal || 'Resolver una consulta').slice(0, 300),
            difficulty: ['easy', 'medium', 'hard'].includes(p.difficulty) ? p.difficulty : 'medium',
            language: 'es-CO',
            source: 'synthetic',
            openingMessage: String(p.openingMessage || 'Hola, tengo una consulta').slice(0, 500),
        }));

        if (!scenarios.length) throw new Error('La generación de escenarios devolvió un resultado vacío');
        return scenarios;
    }

    /** Strip judge/transcript from a previous run's results to reuse the customer scripts. */
    private async loadScenariosFromRun(schemaName: string, runId: string): Promise<ScenarioDef[]> {
        return withSimulationReplayRun(this.prisma,schemaName,runId,async(_query,run)=>(run.results || []).map(scenarioDefinition));
    }

    // ---------------------------------------------------------------------
    // Scenario execution
    // ---------------------------------------------------------------------
    private async runScenariosConcurrently(
        tenantId: string,
        agentId: string,
        channelType: string,
        scenarios: ScenarioDef[],
        snapshot?: AgentEvaluationSnapshot, session?: EvalSandboxSession,
        previous: ScenarioResult[] = [], checkpoint?: (results: ScenarioResult[]) => Promise<void>,
        replayRun?: {schemaName:string;runId:string},
    ): Promise<ScenarioResult[]> {
        if (!snapshot) throw new Error('evaluation_revision_manifest_required');
        const results: ScenarioResult[] = new Array(scenarios.length);
        let cursor = 0;

        const worker = async () => {
            while (true) {
                const idx = cursor++;
                if (idx >= scenarios.length) break;
                try {
                    const scenarioHash = revisionHash(scenarios[idx]);
                    await this.agentTest.assertSnapshotExecutable(snapshot, tenantId, agentId);
                    const completed = previous.find(r => r.key === scenarios[idx].key && (r as any).scenarioHash === scenarioHash && isScoredScenario(r));
                    if (completed) {
                        if (isReplayDefinition(completed)) {
                            if (!replayRun) throw new SimulationReplayUnavailable();
                            await withSimulationReplayRun(this.prisma,replayRun.schemaName,replayRun.runId,async()=>undefined);
                        }
                        results[idx] = completed; continue;
                    }
                    await session?.reset(channelType, snapshot);
                    results[idx] = await this.runScenario(tenantId, agentId, channelType, session?.fixtures ? bindCanonicalEvalFixtures(scenarios[idx],session.fixtures) : scenarios[idx], snapshot, session, replayRun);
                    Object.assign(results[idx], {scenarioHash});
                } catch (err: any) {
                    if (err instanceof SimulationReplayUnavailable) throw err;
                    const s = scenarios[idx];
                    results[idx] = {
                        ...s,
                        ...(err.partialScenario || {}),
                        transcript: err.partialScenario?.transcript || [],
                        turns: err.partialScenario?.turns || 0,
                        latencyMs: err.partialScenario?.latencyMs || 0,
                        judge: null,
                        error: String(err.message || err).slice(0, 500),
                    };
                }
                await checkpoint?.(results);
            }
        };

        const pool = Array.from({ length: Math.min(session ? 1 : SCENARIO_CONCURRENCY, scenarios.length) }, () => worker());
        await Promise.all(pool);
        return results;
    }

    private async runScenario(
        tenantId: string,
        agentId: string,
        channelType: string,
        scenario: ScenarioDef,
        snapshot?: AgentEvaluationSnapshot, session?: EvalSandboxSession,
        replayRun?: {schemaName:string;runId:string},
    ): Promise<ScenarioResult> {
        if (!snapshot) throw new Error('evaluation_revision_manifest_required');
        await this.agentTest.assertSnapshotExecutable(snapshot, tenantId, agentId);
        const startedAt = Date.now();
        const transcript: Array<{ role: 'customer' | 'agent'; content: string }> = [];
        const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

        const falseClaims: Array<{ turn: number; reply: string }> = [];

        const useSource = async <T>(work:(assertSource?:()=>Promise<void>)=>Promise<T>):Promise<T> => {
            if (!isReplayDefinition(scenario)) return work();
            if (!replayRun) throw new SimulationReplayUnavailable();
            return withSimulationReplayRun(this.prisma,replayRun.schemaName,replayRun.runId,async(query,run)=>{
                await assertSimulationReplayRun(query,{...run,scenario_definitions:[scenario]});
                return work(()=>assertSimulationReplayRun(query,{...run,scenario_definitions:[scenario]}));
            });
        };
        const askAgent = async (customerMsg: string): Promise<string> => useSource(async (assertSource) => {
            const beforeExecution=async()=>{ await session?.assertLease?.(); await assertSource?.(); };
            const sandboxInboundMessageId=await session?.recordInbound(customerMsg);
            const res = await this.agentTest.test(
                tenantId,
                agentId,
                { message: customerMsg, conversationHistory: [...history], channelType: channelType as any },
                { disableTools: false, agentSnapshot: snapshot, ...(session ? { evalMode: true, sandboxContactId: session.sandboxContactId, sandboxConversationId: session.sandboxConversationId, sandboxNamespace: session.sandboxNamespace, sandboxInboundMessageId, beforeToolExecution: beforeExecution, beforeModelExecution: beforeExecution } : {}) },
            );
            if (res.debug?.runtimeError) throw new Error(`agent_runtime_failed:${res.debug.runtimeError}`);
            const reply = res.reply || '';
            // The judge grades how the agent SOUNDS. This grades whether it told
            // the truth. In production the agent announced "¡Tu reserva está
            // confirmada!" on a turn where the guard had executed nothing, and
            // the customer left believing they had an apartment — a transcript
            // that reads beautifully and scores well while being a lie. A claim
            // of a completed booking, payment or cancellation only counts when a
            // writing tool actually succeeded in that same turn.
            const audit = auditTurnClaim(reply, (res as any)?.debug?.toolCalls);
            if (audit.falseClaim) {
                falseClaims.push({ turn: Math.floor(transcript.length / 2) + 1, reply: reply.slice(0, 300) });
            }
            transcript.push({ role: 'customer', content: customerMsg });
            transcript.push({ role: 'agent', content: reply });
            history.push({ role: 'user', content: customerMsg });
            history.push({ role: 'assistant', content: reply });
            return reply;
        });

        try {
        // Register durably before opening the source-use fence. A second connection
        // acquiring shared behind a queued erasure would deadlock with the outer fence.
        // If erasure wins between registration and use, useSource rejects before copying.
        if (isReplayDefinition(scenario) && replayRun && session?.sandboxNamespace) {
            await registerSimulationReplayNamespace(this.prisma,replayRun.schemaName,replayRun.runId,session.sandboxNamespace);
        }
        if (scenario.source === 'replay' && scenario.replayMessages?.length) {
            for (const msg of scenario.replayMessages.slice(0, MAX_REPLAY_MESSAGES)) {
                await askAgent(msg);
            }
        } else {
            let customerMsg = scenario.openingMessage;
            for (let turn = 0; turn < MAX_TURNS; turn++) {
                await askAgent(customerMsg);
                if (turn === MAX_TURNS - 1) break;
                await this.agentTest.assertSnapshotExecutable(snapshot);
                const next = await this.nextCustomerMessage(tenantId, scenario, transcript, this.agentTest.snapshotSourceAuthority(snapshot));
                await this.agentTest.assertSnapshotExecutable(snapshot);
                if (next === '[FIN]') break;
                customerMsg = next;
            }
        }

        const transcriptText = transcript
            .map((t) => `${t.role === 'customer' ? 'Cliente' : 'Agente'}: ${t.content}`)
            .join('\n');

        await this.agentTest.assertSnapshotExecutable(snapshot);
        const judge = await useSource(()=>this.qualityService.judgeTranscript(tenantId, transcriptText, AGENT_TEST_EXECUTION_CONTEXT,
            this.agentTest.snapshotSourceAuthority(snapshot)));
        await this.agentTest.assertSnapshotExecutable(snapshot);

        return {
            ...scenario,
            transcript,
            turns: Math.floor(transcript.length / 2),
            latencyMs: Date.now() - startedAt,
            judge,
            falseClaims: falseClaims.length ? falseClaims : undefined,
        };
        } catch (cause: any) {
            if (cause instanceof SimulationReplayUnavailable) throw cause;
            const error = new Error(String(cause?.message || cause));
            Object.assign(error, { partialScenario: { transcript, turns: Math.floor(transcript.length / 2), latencyMs: Date.now() - startedAt, falseClaims } });
            throw error;
        }
    }

    /** The customer simulator LLM produces the next customer message. */
    private async nextCustomerMessage(
        tenantId: string,
        scenario: ScenarioDef,
        transcript: Array<{ role: 'customer' | 'agent'; content: string }>,
        withSourceAuthority: LLMSourceAuthority,
    ): Promise<string> {
        if (!withSourceAuthority) throw new Error('evaluation_source_authority_required');
        const persona = scenario.personaDescription || 'Un cliente típico de Latinoamérica';
        const systemPrompt = `Estás simulando ser un CLIENTE real escribiendo por chat a un negocio en Latinoamérica.
Tu perfil: ${persona}
Tu objetivo en esta conversación: ${scenario.goal}

Reglas:
- Responde SIEMPRE como el cliente (nunca como el agente del negocio).
- Escribe UN solo mensaje corto y natural, en el idioma ${scenario.language}, como una persona real por chat.
- Mantente fiel a tu objetivo y reacciona de forma realista a lo que dice el agente.
- Si tu objetivo ya se cumplió, o si decides que no vas a continuar (te frustras o pierdes interés), responde EXACTAMENTE con el texto [FIN] y nada más.
- No expliques que eres una simulación. No uses comillas.`;

        const convo = transcript
            .map((t) => `${t.role === 'customer' ? 'Tú (cliente)' : 'Agente del negocio'}: ${t.content}`)
            .join('\n');

        try {
            const res = await this.llmRouter.execute({
                task: 'conversation',
                allowedTiers: ['tier_2_standard', 'tier_3_efficient'],
                messages: [
                    {
                        role: 'user',
                        content: `Conversación hasta ahora:\n${convo}\n\nEscribe tu siguiente mensaje como cliente (o [FIN] si terminaste):`,
                    },
                ],
                systemPrompt,
                temperature: 0.6,
                maxTokens: 200,
                tenantId,
                executionContext: AGENT_TEST_EXECUTION_CONTEXT,
                withSourceAuthority,
            });
            const next = (res.content || '').trim();
            if (!next) throw new Error('empty_customer_message');
            return next;
        } catch (err: any) {
            this.logger.warn(`[Sim] Customer simulator failed: ${err.message}`);
            throw new Error('customer_simulator_failed:' + String(err.message || err));
        }
    }

    // ---------------------------------------------------------------------
    // Aggregation + regression
    // ---------------------------------------------------------------------
    private async buildSummary(
        schemaName: string,
        results: ScenarioResult[],
        baselineRunId: string | null,
    ): Promise<any> {
        const scored = results.filter(isScoredScenario);
        const byDifficulty: Record<string, { count: number; avg: number }> = {};
        for (const r of scored) {
            const d = r.difficulty || 'medium';
            if (!byDifficulty[d]) byDifficulty[d] = { count: 0, avg: 0 };
            byDifficulty[d].count++;
            byDifficulty[d].avg += r.judge.overall;
        }
        for (const d of Object.keys(byDifficulty)) {
            byDifficulty[d].avg = Math.round((byDifficulty[d].avg / byDifficulty[d].count) * 100) / 100;
        }

        // Worst scenarios (lowest overall, or with flags) for drill-down.
        const worst = [...scored]
            .sort((a, b) => a.judge.overall - b.judge.overall)
            .slice(0, 10)
            .map((r) => ({
                key: r.key,
                title: r.title,
                overall: r.judge.overall,
                resolved: r.judge.resolved,
                flags: r.judge.flags,
            }));

        const summary: any = {
            total: results.length,
            scored: scored.length,
            failed: results.length - scored.length,
            byDifficulty,
            complete: results.length > 0 && scored.length === results.length,
            failures: results.filter(r => !isScoredScenario(r)).map(r => ({ key: r.key, title: r.title, error: r.error || 'judge_missing' })),
            falseClaimCount: results.reduce((sum, r) => sum + (r.falseClaims?.length || 0), 0),
            avgSubScores: {
                resolution: this.avg(scored, (r) => r.judge.resolution),
                tone: this.avg(scored, (r) => r.judge.tone),
                accuracy: this.avg(scored, (r) => r.judge.accuracy),
                empathy: this.avg(scored, (r) => r.judge.empathy),
            },
            worst,
        };

        // Regression diff vs baseline (match scenarios by key).
        if (baselineRunId) {
            const base = await withSimulationReplayRun(this.prisma,schemaName,baselineRunId,async(_query,run)=>run);
            const baseResults: ScenarioResult[] = Array.isArray(base.results) ? base.results : [];
            const baseAvg = Number(base.avg_score) || 0;
            const baseByKey = new Map(baseResults.map((b) => [b.key, b]));

            const regressions: any[] = [];
            const improvements: any[] = [];
            for (const r of scored) {
                const b = baseByKey.get(r.key);
                if (!b || b.error || !b.judge) continue;
                const before = b.judge.overall;
                const after = r.judge.overall;
                const delta = Math.round((after - before) * 100) / 100;
                if ((r.falseClaims?.length || 0) > (b.falseClaims?.length || 0)) {
                    regressions.push({ key: r.key, title: r.title, before, after, delta, reason: 'new_false_claim' });
                } else if (after <= before - REGRESSION_THRESHOLD) {
                    regressions.push({ key: r.key, title: r.title, before, after, delta });
                } else if (after >= before + REGRESSION_THRESHOLD) {
                    improvements.push({ key: r.key, title: r.title, before, after, delta });
                }
            }
            for (const b of baseResults.filter(isScoredScenario)) {
                const current = results.find(r => r.key === b.key);
                if (!current || !isScoredScenario(current)) regressions.push({ key: b.key, title: b.title,
                    before: b.judge.overall, after: null, reason: !current ? 'scenario_missing' : 'scenario_failed', error: current?.error });
            }
            const curAvg = scored.length
                ? scored.reduce((s, r) => s + r.judge.overall, 0) / scored.length
                : 0;
            summary.baseline = {
                runId: baselineRunId,
                baselineAvg: Math.round(baseAvg * 100) / 100,
                avgDelta: Math.round((curAvg - baseAvg) * 100) / 100,
                regressions,
                improvements,
                hasRegression: regressions.length > 0,
            };
        }

        return summary;
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    private async resolveAgentId(tenantId: string, agentId?: string): Promise<string> {
        if (agentId) {
            const agent = await this.personaService.getAgent(tenantId, agentId);
            if (!agent) throw new BadRequestException('Agente no encontrado');
            return agentId;
        }
        const agents = await this.personaService.listAgents(tenantId);
        if (!agents?.length) {
            throw new BadRequestException('No hay agentes configurados para simular');
        }
        const def = agents.find((a) => a.is_default) || agents.find((a) => a.is_active) || agents[0];
        return def.id;
    }

    private mapRunSummary(r: any) {
        return {
            id: r.id,
            agentId: r.agent_id,
            channelType: r.channel_type,
            scenarioSource: r.scenario_source,
            vertical: r.vertical,
            status: r.status,
            scenarioCount: Number(r.scenario_count) || 0,
            avgScore: r.avg_score != null ? Number(r.avg_score) : null,
            resolvedRate: r.resolved_rate != null ? Number(r.resolved_rate) : null,
            summary: r.summary || null,
            baselineRunId: r.baseline_run_id || null,
            error: r.error || null,
            createdAt: r.created_at,
            completedAt: r.completed_at,
        };
    }

    private avg(rows: ScoredScenarioResult[], pick: (r: ScoredScenarioResult) => number): number {
        if (!rows.length) return 0;
        return Math.round((rows.reduce((s, r) => s + (pick(r) || 0), 0) / rows.length) * 100) / 100;
    }

    private safeJsonArray(raw: string): any[] {
        const text = raw
            .trim()
            .replace(/^```(?:json)?/i, '')
            .replace(/```$/, '')
            .trim();
        try {
            const match = text.match(/\[[\s\S]*\]/);
            const parsed = JSON.parse(match ? match[0] : text);
            if (Array.isArray(parsed)) return parsed;
        } catch {
            // Cae al rescate de abajo.
        }

        // Rescate de respuesta truncada. Un array cortado a la mitad no cierra el
        // corchete, así que el parseo completo falla y antes devolvíamos CERO
        // escenarios — perdiendo también los veinte que sí habían llegado
        // enteros. Se recuperan objeto por objeto, respetando comillas y escapes
        // para no cortar dentro de un string.
        const objects: any[] = [];
        let depth = 0;
        let start = -1;
        let inString = false;
        let escaped = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') { inString = true; continue; }
            if (ch === '{') { if (depth === 0) start = i; depth++; continue; }
            if (ch === '}' && depth > 0) {
                depth--;
                if (depth === 0 && start >= 0) {
                    try { objects.push(JSON.parse(text.slice(start, i + 1))); } catch { /* incompleto */ }
                    start = -1;
                }
            }
        }

        if (objects.length) {
            this.logger.warn(`[Sim] Respuesta truncada: se rescataron ${objects.length} escenarios completos`);
        } else {
            this.logger.warn('[Sim] Failed to parse scenario JSON array');
        }
        return objects;
    }
}
