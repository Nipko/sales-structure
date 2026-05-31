import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { PersonaService } from '../persona/persona.service';
import { QualityService, JudgeResult } from '../quality/quality.service';
import { AgentTestService } from '../conversations/agent-test.service';

export const SIMULATION_QUEUE = 'agent-simulation';

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
}

interface ScenarioResult extends ScenarioDef {
    transcript: Array<{ role: 'customer' | 'agent'; content: string }>;
    judge: JudgeResult;
    turns: number;
    latencyMs: number;
    error?: string;
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
    ) {}

    // ---------------------------------------------------------------------
    // Table bootstrap
    // ---------------------------------------------------------------------
    async ensureTables(schemaName: string): Promise<void> {
        const cacheKey = `simulation_cols:${schemaName}`;
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
        const channelType = input.channelType || 'whatsapp';
        const source = input.scenarioSource === 'replay' ? 'replay' : 'synthetic';

        const requestedCount = Math.min(Math.max(Number(input.count) || 50, 1), MAX_COUNT);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO simulation_runs
                (agent_id, channel_type, scenario_source, vertical, status, scenario_count, baseline_run_id, created_by)
             VALUES ($1::uuid, $2, $3, $4, 'pending', $5, $6, $7)
             RETURNING id`,
            [agentId, channelType, source, input.vertical || null, requestedCount, input.baselineRunId || null, input.createdBy || null],
        );
        const runId: string = rows?.[0]?.id;

        await this.queue.add(
            'run',
            { tenantId, runId },
            {
                jobId: `sim-${runId}`,
                attempts: 1, // long-running multi-LLM job — never auto-retry the whole batch
                removeOnComplete: true,
                removeOnFail: 50,
            },
        );

        this.logger.log(`[Sim] Enqueued run ${runId} (tenant=${tenantId}, agent=${agentId}, source=${source})`);
        return { runId };
    }

    async listRuns(tenantId: string, limit = 20): Promise<any[]> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, agent_id, channel_type, scenario_source, vertical, status, scenario_count,
                    avg_score, resolved_rate, summary, baseline_run_id, error, created_at, completed_at
             FROM simulation_runs
             ORDER BY created_at DESC
             LIMIT $1`,
            [Math.min(limit, 100)],
        );
        return (rows || []).map((r) => this.mapRunSummary(r));
    }

    async getRun(tenantId: string, runId: string): Promise<any | null> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM simulation_runs WHERE id = $1::uuid`,
            [runId],
        );
        const r = rows?.[0];
        if (!r) return null;
        return {
            ...this.mapRunSummary(r),
            personaVersion: r.persona_version,
            results: Array.isArray(r.results) ? r.results : [],
        };
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

        try {
            const agentId: string = run.agent_id;
            const channelType: string = run.channel_type || 'whatsapp';
            const agent = await this.personaService.getAgent(tenantId, agentId);
            if (!agent) throw new Error(`Agent ${agentId} not found`);
            const personaVersion = agent.version ?? null;
            const personaSnapshot = agent.config_json ?? null;

            // 1. Build scenario set. (scenario_count holds the requested count until
            // the run completes, when it is overwritten with the actual scenario count.)
            const requestedCount = Math.min(Math.max(Number(run.scenario_count) || 50, 1), MAX_COUNT);
            const baselineRunId: string | null = run.baseline_run_id || null;
            let scenarios: ScenarioDef[];
            if (baselineRunId) {
                scenarios = await this.loadScenariosFromRun(schemaName, baselineRunId);
                if (!scenarios.length) throw new Error('Baseline run has no reusable scenarios');
            } else if (run.scenario_source === 'replay') {
                scenarios = await this.buildReplayScenarios(schemaName, requestedCount || 50);
                if (!scenarios.length) {
                    throw new Error('No hay conversaciones históricas suficientes para reproducir');
                }
            } else {
                scenarios = await this.generateSyntheticScenarios(
                    tenantId,
                    run.vertical || (personaSnapshot?.business?.industry as string) || null,
                    requestedCount || 50,
                );
            }

            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE simulation_runs
                 SET status = 'running', scenario_count = $2, persona_version = $3, persona_snapshot = $4::jsonb
                 WHERE id = $1::uuid`,
                [runId, scenarios.length, personaVersion, JSON.stringify(personaSnapshot)],
            );

            // 2. Run scenarios with bounded concurrency.
            const results = await this.runScenariosConcurrently(tenantId, agentId, channelType, scenarios);

            // 3. Aggregate + regression diff.
            const summary = await this.buildSummary(schemaName, results, baselineRunId);

            const scored = results.filter((r) => !r.error);
            const avgScore = scored.length
                ? Math.round((scored.reduce((s, r) => s + (r.judge?.overall || 0), 0) / scored.length) * 100) / 100
                : 0;
            const resolvedRate = scored.length
                ? Math.round((scored.filter((r) => r.judge?.resolved).length / scored.length) * 10000) / 100
                : 0;

            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE simulation_runs
                 SET status = 'completed', results = $2::jsonb, summary = $3::jsonb,
                     avg_score = $4, resolved_rate = $5, completed_at = NOW()
                 WHERE id = $1::uuid`,
                [runId, JSON.stringify(results), JSON.stringify(summary), avgScore, resolvedRate],
            );

            this.logger.log(
                `[Sim] Run ${runId} completed: ${scored.length}/${results.length} scored, avg=${avgScore}, resolved=${resolvedRate}%`,
            );
        } catch (err: any) {
            this.logger.error(`[Sim] Run ${runId} failed: ${err.message}`);
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE simulation_runs SET status = 'failed', error = $2, completed_at = NOW() WHERE id = $1::uuid`,
                [runId, String(err.message || err).slice(0, 1000)],
            );
        }
    }

    // ---------------------------------------------------------------------
    // Scenario sources
    // ---------------------------------------------------------------------

    /** Reconstruct customer scripts from real historical conversations. */
    private async buildReplayScenarios(schemaName: string, count: number): Promise<ScenarioDef[]> {
        const convs = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT c.id,
                    (SELECT m.content_text FROM messages m
                       WHERE m.conversation_id = c.id AND m.direction = 'inbound' AND m.content_text IS NOT NULL
                       ORDER BY m.created_at ASC LIMIT 1) AS first_msg
             FROM conversations c
             WHERE EXISTS (
                 SELECT 1 FROM messages m2
                 WHERE m2.conversation_id = c.id AND m2.direction = 'inbound' AND m2.content_text IS NOT NULL
             )
             ORDER BY c.created_at DESC
             LIMIT $1`,
            [Math.min(count, MAX_COUNT)],
        );

        const scenarios: ScenarioDef[] = [];
        for (const c of convs || []) {
            const inbound = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT content_text FROM messages
                 WHERE conversation_id = $1::uuid AND direction = 'inbound' AND content_text IS NOT NULL
                 ORDER BY created_at ASC
                 LIMIT $2`,
                [c.id, MAX_REPLAY_MESSAGES],
            );
            const messages = (inbound || []).map((m) => String(m.content_text)).filter(Boolean);
            if (!messages.length) continue;
            scenarios.push({
                key: `replay:${c.id}`,
                title: String(c.first_msg || messages[0]).slice(0, 80),
                goal: 'Reproducir una conversación real de un cliente histórico',
                language: 'es-CO',
                source: 'replay',
                openingMessage: messages[0],
                replayMessages: messages,
            });
        }
        return scenarios;
    }

    /** LLM generates synthetic customer personas + goals for the tenant's vertical. */
    private async generateSyntheticScenarios(
        tenantId: string,
        vertical: string | null,
        count: number,
    ): Promise<ScenarioDef[]> {
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
                maxTokens: 3000,
                tenantId,
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
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT results FROM simulation_runs WHERE id = $1::uuid`,
            [runId],
        );
        const results = rows?.[0]?.results;
        if (!Array.isArray(results)) return [];
        return results.map((r: any) => ({
            key: r.key,
            title: r.title,
            personaDescription: r.personaDescription,
            goal: r.goal,
            difficulty: r.difficulty,
            language: r.language || 'es-CO',
            source: r.source,
            openingMessage: r.openingMessage,
            replayMessages: r.replayMessages,
        }));
    }

    // ---------------------------------------------------------------------
    // Scenario execution
    // ---------------------------------------------------------------------
    private async runScenariosConcurrently(
        tenantId: string,
        agentId: string,
        channelType: string,
        scenarios: ScenarioDef[],
    ): Promise<ScenarioResult[]> {
        const results: ScenarioResult[] = new Array(scenarios.length);
        let cursor = 0;

        const worker = async () => {
            while (true) {
                const idx = cursor++;
                if (idx >= scenarios.length) break;
                try {
                    results[idx] = await this.runScenario(tenantId, agentId, channelType, scenarios[idx]);
                } catch (err: any) {
                    const s = scenarios[idx];
                    results[idx] = {
                        ...s,
                        transcript: [],
                        turns: 0,
                        latencyMs: 0,
                        judge: this.emptyJudge(),
                        error: String(err.message || err).slice(0, 500),
                    };
                }
            }
        };

        const pool = Array.from({ length: Math.min(SCENARIO_CONCURRENCY, scenarios.length) }, () => worker());
        await Promise.all(pool);
        return results;
    }

    private async runScenario(
        tenantId: string,
        agentId: string,
        channelType: string,
        scenario: ScenarioDef,
    ): Promise<ScenarioResult> {
        const startedAt = Date.now();
        const transcript: Array<{ role: 'customer' | 'agent'; content: string }> = [];
        const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

        const askAgent = async (customerMsg: string): Promise<string> => {
            const res = await this.agentTest.test(
                tenantId,
                agentId,
                { message: customerMsg, conversationHistory: [...history], channelType: channelType as any },
                { disableTools: true },
            );
            const reply = res.reply || '';
            transcript.push({ role: 'customer', content: customerMsg });
            transcript.push({ role: 'agent', content: reply });
            history.push({ role: 'user', content: customerMsg });
            history.push({ role: 'assistant', content: reply });
            return reply;
        };

        if (scenario.source === 'replay' && scenario.replayMessages?.length) {
            for (const msg of scenario.replayMessages.slice(0, MAX_REPLAY_MESSAGES)) {
                await askAgent(msg);
            }
        } else {
            let customerMsg = scenario.openingMessage;
            for (let turn = 0; turn < MAX_TURNS; turn++) {
                await askAgent(customerMsg);
                if (turn === MAX_TURNS - 1) break;
                const next = await this.nextCustomerMessage(tenantId, scenario, transcript);
                if (!next || /\[FIN\]/i.test(next)) break;
                customerMsg = next;
            }
        }

        const transcriptText = transcript
            .map((t) => `${t.role === 'customer' ? 'Cliente' : 'Agente'}: ${t.content}`)
            .join('\n');

        let judge: JudgeResult;
        try {
            judge = await this.qualityService.judgeTranscript(tenantId, transcriptText);
        } catch (err: any) {
            this.logger.warn(`[Sim] Judge failed for scenario ${scenario.key}: ${err.message}`);
            judge = this.emptyJudge();
        }

        return {
            ...scenario,
            transcript,
            turns: Math.floor(transcript.length / 2),
            latencyMs: Date.now() - startedAt,
            judge,
        };
    }

    /** The customer simulator LLM produces the next customer message. */
    private async nextCustomerMessage(
        tenantId: string,
        scenario: ScenarioDef,
        transcript: Array<{ role: 'customer' | 'agent'; content: string }>,
    ): Promise<string> {
        const persona = scenario.personaDescription || 'Un cliente típico de Latinoamérica';
        const systemPrompt = `Estás simulando ser un CLIENTE real escribiendo por WhatsApp a un negocio en Latinoamérica.
Tu perfil: ${persona}
Tu objetivo en esta conversación: ${scenario.goal}

Reglas:
- Responde SIEMPRE como el cliente (nunca como el agente del negocio).
- Escribe UN solo mensaje corto y natural, en español coloquial, como una persona real por chat.
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
            });
            return (res.content || '').trim();
        } catch (err: any) {
            this.logger.warn(`[Sim] Customer simulator failed: ${err.message}`);
            return '[FIN]';
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
        const scored = results.filter((r) => !r.error);
        const byDifficulty: Record<string, { count: number; avg: number }> = {};
        for (const r of scored) {
            const d = r.difficulty || 'medium';
            if (!byDifficulty[d]) byDifficulty[d] = { count: 0, avg: 0 };
            byDifficulty[d].count++;
            byDifficulty[d].avg += r.judge.overall || 0;
        }
        for (const d of Object.keys(byDifficulty)) {
            byDifficulty[d].avg = Math.round((byDifficulty[d].avg / byDifficulty[d].count) * 100) / 100;
        }

        // Worst scenarios (lowest overall, or with flags) for drill-down.
        const worst = [...scored]
            .sort((a, b) => (a.judge.overall || 0) - (b.judge.overall || 0))
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
            const baseRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT results, avg_score FROM simulation_runs WHERE id = $1::uuid`,
                [baselineRunId],
            );
            const baseResults: ScenarioResult[] = Array.isArray(baseRows?.[0]?.results) ? baseRows[0].results : [];
            const baseAvg = Number(baseRows?.[0]?.avg_score) || 0;
            const baseByKey = new Map(baseResults.map((b) => [b.key, b]));

            const regressions: any[] = [];
            const improvements: any[] = [];
            for (const r of scored) {
                const b = baseByKey.get(r.key);
                if (!b || b.error) continue;
                const before = b.judge?.overall || 0;
                const after = r.judge.overall || 0;
                const delta = Math.round((after - before) * 100) / 100;
                if (after <= before - REGRESSION_THRESHOLD) {
                    regressions.push({ key: r.key, title: r.title, before, after, delta });
                } else if (after >= before + REGRESSION_THRESHOLD) {
                    improvements.push({ key: r.key, title: r.title, before, after, delta });
                }
            }
            const curAvg = scored.length
                ? scored.reduce((s, r) => s + (r.judge.overall || 0), 0) / scored.length
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

    private avg(rows: ScenarioResult[], pick: (r: ScenarioResult) => number): number {
        if (!rows.length) return 0;
        return Math.round((rows.reduce((s, r) => s + (pick(r) || 0), 0) / rows.length) * 100) / 100;
    }

    private emptyJudge(): JudgeResult {
        return { overall: 0, resolution: 0, tone: 0, accuracy: 0, empathy: 0, flags: [], resolved: false, resolutionReason: '' };
    }

    private safeJsonArray(raw: string): any[] {
        try {
            const match = raw.match(/\[[\s\S]*\]/);
            const parsed = JSON.parse(match ? match[0] : raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            this.logger.warn('[Sim] Failed to parse scenario JSON array');
            return [];
        }
    }
}
