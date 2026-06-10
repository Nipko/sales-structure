import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgentTestService } from '../conversations/agent-test.service';
import { QualityService } from '../quality/quality.service';

export interface EvalScenarioInput {
    key: string;
    title: string;
    vertical?: string;
    language?: string;
    /** Ordered customer messages (deterministic — this is what makes the gate stable). */
    messages: string[];
    /** Free-text description of what a correct handling looks like (judged). */
    criteria?: string;
}

export interface EvalGateResult {
    passed: boolean;
    avgScore: number;
    threshold: number;
    total: number;
    scenarios: Array<{ key: string; title: string; score: number; resolved: boolean; flags?: string[]; error?: string }>;
}

const DEFAULT_THRESHOLD = 7;     // overall (0-10) the suite must average to pass
const MAX_SCENARIO_MESSAGES = 8;

/**
 * Evals as a deploy gate (#2). Runs a CURATED golden set of conversations through
 * the real prompt pipeline (AgentTestService, tools disabled — zero side effects)
 * and scores each with the shared LLM-judge (QualityService). Unlike ad-hoc
 * synthetic simulation, golden scenarios are a FIXED message sequence, so the gate
 * is stable across runs (avoids "Lost in Simulation" score inflation).
 *
 * Phase 1: quality-judge gate. Phase 2 (noted): τ²-style action verification
 * (tools enabled against a test-tenant DB), pass^k for non-determinism, and CI
 * auto-run on persona/contract/registry edits with a minimum score to activate.
 */
@Injectable()
export class EvalService {
    private readonly logger = new Logger(EvalService.name);
    private readonly ensured = new Set<string>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly agentTest: AgentTestService,
        private readonly quality: QualityService,
    ) {}

    private async ensureTable(schema: string): Promise<void> {
        if (this.ensured.has(schema)) return;
        try {
            await this.prisma.executeInTenantSchema(schema,
                `CREATE TABLE IF NOT EXISTS eval_scenarios (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    key TEXT UNIQUE NOT NULL,
                    title TEXT NOT NULL,
                    vertical TEXT,
                    language TEXT NOT NULL DEFAULT 'es',
                    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
                    criteria TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                 )`);
            this.ensured.add(schema);
        } catch (e: any) {
            if (/already exists|duplicate|23505|42P07/i.test(e?.message || '')) this.ensured.add(schema);
            else throw e;
        }
    }

    async listScenarios(tenantId: string): Promise<any[]> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTable(schema);
        let rows = await this.fetch(schema);
        if (!rows.length) {
            await this.seedDefaults(schema);
            rows = await this.fetch(schema);
        }
        return rows;
    }

    private async fetch(schema: string): Promise<any[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, key, title, vertical, language, messages, criteria FROM eval_scenarios ORDER BY created_at`);
        return (rows || []).map(r => ({
            id: r.id, key: r.key, title: r.title, vertical: r.vertical, language: r.language,
            messages: Array.isArray(r.messages) ? r.messages : [],
            criteria: r.criteria || undefined,
        }));
    }

    async addScenario(tenantId: string, def: EvalScenarioInput): Promise<void> {
        if (!def?.key || !def?.title || !Array.isArray(def.messages) || !def.messages.length) {
            throw new BadRequestException('key, title and a non-empty messages[] are required');
        }
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTable(schema);
        await this.prisma.executeInTenantSchema(schema,
            `INSERT INTO eval_scenarios (key, title, vertical, language, messages, criteria)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)
             ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, vertical = EXCLUDED.vertical,
                 language = EXCLUDED.language, messages = EXCLUDED.messages, criteria = EXCLUDED.criteria`,
            [def.key, def.title, def.vertical || null, def.language || 'es',
             JSON.stringify(def.messages.slice(0, MAX_SCENARIO_MESSAGES)), def.criteria || null]);
    }

    async deleteScenario(tenantId: string, id: string): Promise<void> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.prisma.executeInTenantSchema(schema, `DELETE FROM eval_scenarios WHERE id = $1::uuid`, [id]);
    }

    /** Run the golden set through the agent and gate on the average judge score. */
    async runGate(tenantId: string, agentId: string, threshold = DEFAULT_THRESHOLD): Promise<EvalGateResult> {
        if (!agentId) throw new BadRequestException('agentId is required');
        const scenarios = await this.listScenarios(tenantId);
        if (!scenarios.length) return { passed: true, avgScore: 0, threshold, total: 0, scenarios: [] };

        const out: EvalGateResult['scenarios'] = [];
        for (const sc of scenarios) {
            try {
                out.push(await this.runScenario(tenantId, agentId, sc));
            } catch (e: any) {
                this.logger.warn(`[Eval] scenario ${sc.key} failed: ${e.message}`);
                out.push({ key: sc.key, title: sc.title, score: 0, resolved: false, error: e.message });
            }
        }
        const scored = out.filter(r => !r.error);
        const avg = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : 0;
        const avgScore = Math.round(avg * 100) / 100;
        return { passed: avgScore >= threshold, avgScore, threshold, total: out.length, scenarios: out };
    }

    private async runScenario(tenantId: string, agentId: string, sc: any): Promise<EvalGateResult['scenarios'][number]> {
        const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        const lines: string[] = [];
        for (const msg of (sc.messages || []).slice(0, MAX_SCENARIO_MESSAGES)) {
            const res = await this.agentTest.test(
                tenantId, agentId,
                { message: msg, conversationHistory: [...history], channelType: 'whatsapp' as any },
                { disableTools: true },
            );
            const reply = res?.reply || '';
            lines.push(`Cliente: ${msg}`, `Agente: ${reply}`);
            history.push({ role: 'user', content: msg }, { role: 'assistant', content: reply });
        }
        let transcript = lines.join('\n');
        if (sc.criteria) transcript += `\n\n[Criterio esperado para esta conversación: ${sc.criteria}]`;
        const judge = await this.quality.judgeTranscript(tenantId, transcript);
        return {
            key: sc.key,
            title: sc.title,
            score: typeof judge.overall === 'number' ? judge.overall : 0,
            resolved: !!judge.resolved,
            flags: judge.flags || [],
        };
    }

    /** Seed a few generic, vertical-agnostic scenarios so the gate is usable out of the box. */
    private async seedDefaults(schema: string): Promise<void> {
        const defaults: EvalScenarioInput[] = [
            { key: 'greeting', title: 'Saludo inicial', language: 'es', messages: ['Hola, buenas'], criteria: 'Saluda con calidez, se presenta brevemente y ofrece ayuda sin abrumar.' },
            { key: 'price_question', title: 'Pregunta de precio', language: 'es', messages: ['¿Cuánto cuesta?', '¿Y eso incluye todo?'], criteria: 'No inventa precios; si no los tiene, lo dice y ofrece confirmarlos. Resuelve la anáfora del segundo mensaje.' },
            { key: 'booking_intent', title: 'Quiere agendar', language: 'es', messages: ['Quiero agendar una cita para mañana', 'A las 3 de la tarde'], criteria: 'Conduce el agendamiento paso a paso, confirma fecha/hora correctamente (3pm = 15:00) y pide los datos faltantes.' },
            { key: 'off_topic', title: 'Fuera de tema', language: 'es', messages: ['¿Qué opinás de la política?'], criteria: 'Redirige con amabilidad al propósito del negocio sin ser cortante.' },
        ];
        for (const d of defaults) {
            await this.prisma.executeInTenantSchema(schema,
                `INSERT INTO eval_scenarios (key, title, vertical, language, messages, criteria)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6) ON CONFLICT (key) DO NOTHING`,
                [d.key, d.title, d.vertical || null, d.language || 'es', JSON.stringify(d.messages), d.criteria || null])
                .catch(() => {});
        }
    }
}
