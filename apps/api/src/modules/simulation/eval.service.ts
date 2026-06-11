import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgentTestService } from '../conversations/agent-test.service';
import { QualityService } from '../quality/quality.service';

export type ActionAssertionType = 'row_exists' | 'row_count' | 'no_row';

/** A declarative assertion about a DB side-effect the agent should (or shouldn't) cause. */
export interface ExpectedAction {
    type: ActionAssertionType;
    table: string;                  // must be in VERIFIABLE_TABLES
    /** column → expected value, or { op:'eq'|'ilike'|'date_eq'|'time_eq', value }. */
    where?: Record<string, any>;
    count?: number;                 // for row_count
    description?: string;
}

export interface EvalScenarioInput {
    key: string;
    title: string;
    vertical?: string;
    language?: string;
    /** Ordered customer messages (deterministic — this is what makes the gate stable). */
    messages: string[];
    /** Free-text description of what a correct handling looks like (judged). */
    criteria?: string;
    /** τ²-style: DB side-effects to assert after the run (tools ON, sandbox contact). */
    expectedActions?: ExpectedAction[];
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
const MAX_K = 5;
// Fixed sandbox contact (valid UUID, hex-only) used for action verification. All
// writes/asserts/cleanup are scoped to it so an eval never touches real customer data.
const EVAL_SANDBOX_CONTACT_ID = '00000000-0000-4000-8000-00000000eba1';
// Tables verifyActions may read + cleanupSandbox may delete from. Limited to writers
// whose tool path was audited for evalMode (suppresses outbound side-effects). Add a
// table here ONLY after its writer honours evalMode.
const VERIFIABLE_TABLES = new Set(['appointments']);

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
            await this.prisma.executeInTenantSchema(schema,
                `ALTER TABLE eval_scenarios ADD COLUMN IF NOT EXISTS expected_actions JSONB NOT NULL DEFAULT '[]'::jsonb`);
            await this.prisma.executeInTenantSchema(schema,
                `CREATE TABLE IF NOT EXISTS eval_runs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    agent_id UUID,
                    k INT NOT NULL DEFAULT 1,
                    threshold NUMERIC,
                    passed BOOLEAN,
                    avg_score NUMERIC,
                    eval_activable BOOLEAN NOT NULL DEFAULT false,
                    results JSONB NOT NULL DEFAULT '[]'::jsonb,
                    trigger TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                 )`);
            await this.prisma.executeInTenantSchema(schema,
                `CREATE INDEX IF NOT EXISTS idx_eval_runs_agent ON eval_runs (agent_id)`);
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
            `SELECT id, key, title, vertical, language, messages, criteria, expected_actions FROM eval_scenarios ORDER BY created_at`);
        return (rows || []).map(r => ({
            id: r.id, key: r.key, title: r.title, vertical: r.vertical, language: r.language,
            messages: Array.isArray(r.messages) ? r.messages : [],
            criteria: r.criteria || undefined,
            expectedActions: Array.isArray(r.expected_actions) ? r.expected_actions : [],
        }));
    }

    async addScenario(tenantId: string, def: EvalScenarioInput): Promise<void> {
        if (!def?.key || !def?.title || !Array.isArray(def.messages) || !def.messages.length) {
            throw new BadRequestException('key, title and a non-empty messages[] are required');
        }
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTable(schema);
        await this.prisma.executeInTenantSchema(schema,
            `INSERT INTO eval_scenarios (key, title, vertical, language, messages, criteria, expected_actions)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)
             ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, vertical = EXCLUDED.vertical,
                 language = EXCLUDED.language, messages = EXCLUDED.messages, criteria = EXCLUDED.criteria,
                 expected_actions = EXCLUDED.expected_actions`,
            [def.key, def.title, def.vertical || null, def.language || 'es',
             JSON.stringify(def.messages.slice(0, MAX_SCENARIO_MESSAGES)), def.criteria || null,
             JSON.stringify(Array.isArray(def.expectedActions) ? def.expectedActions : [])]);
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

    /**
     * τ²-style gate (Fase-2): runs the golden set with action verification + pass^k.
     * Scenarios with expectedActions run with TOOLS ENABLED against a sandbox contact
     * in evalMode (the writer suppresses outbound side-effects but still does the local
     * INSERT), then the DB is asserted and cleaned up. Manual trigger (no BullMQ auto-run).
     */
    async runGateV2(
        tenantId: string,
        agentId: string,
        opts?: { threshold?: number; k?: number; passPolicy?: 'all' | 'majority'; activationThreshold?: number; trigger?: string },
    ): Promise<any> {
        if (!agentId) throw new BadRequestException('agentId is required');
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTable(schema);
        await this.ensureSandboxContact(schema);

        const scenarios = await this.listScenarios(tenantId);
        const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
        const k = Math.max(1, Math.min(opts?.k ?? 1, MAX_K));
        const passPolicy = opts?.passPolicy ?? 'all';

        const out: any[] = [];
        for (const sc of scenarios) {
            try {
                const hasActions = Array.isArray(sc.expectedActions) && sc.expectedActions.length > 0;
                out.push(await this.runPassK(tenantId, agentId, schema, sc, k, passPolicy, threshold, hasActions));
            } catch (e: any) {
                this.logger.warn(`[Eval] scenario ${sc.key} failed: ${e.message}`);
                out.push({ key: sc.key, title: sc.title, k, passes: 0, passed: false, score: 0, error: e.message });
            }
        }

        const scored = out.filter(r => !r.error);
        const avgScore = scored.length ? Math.round((scored.reduce((s, r) => s + r.score, 0) / scored.length) * 100) / 100 : 0;
        const passed = out.length > 0 && out.every(r => !r.error && r.passed);
        const evalActivable = passed && avgScore >= (opts?.activationThreshold ?? threshold);
        const result = { passed, avgScore, threshold, k, passPolicy, total: out.length, scenarios: out, evalActivable };
        await this.persistRun(schema, agentId, result, opts?.trigger || 'manual');
        return result;
    }

    /** Run a scenario k times; pass per the policy (all / majority). */
    private async runPassK(tenantId: string, agentId: string, schema: string, sc: any, k: number, passPolicy: 'all' | 'majority', threshold: number, hasActions: boolean) {
        const runs: Array<{ score: number; passed: boolean; actionChecks?: any[] }> = [];
        for (let i = 0; i < k; i++) runs.push(await this.runScenarioWithActions(tenantId, agentId, schema, sc, threshold, hasActions));
        const passes = runs.filter(r => r.passed).length;
        const required = passPolicy === 'all' ? k : Math.ceil(k / 2);
        return {
            key: sc.key,
            title: sc.title,
            k,
            passes,
            passed: passes >= required,
            score: Math.round((runs.reduce((s, r) => s + r.score, 0) / k) * 100) / 100,
            actionChecks: runs[runs.length - 1]?.actionChecks,
        };
    }

    /** One scenario run: judge score + (if expectedActions) verified DB side-effects. */
    private async runScenarioWithActions(tenantId: string, agentId: string, schema: string, sc: any, threshold: number, hasActions: boolean) {
        if (hasActions) await this.cleanupSandbox(schema); // start from a clean slate
        const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        const lines: string[] = [];
        for (const msg of (sc.messages || []).slice(0, MAX_SCENARIO_MESSAGES)) {
            const res = await this.agentTest.test(
                tenantId, agentId,
                { message: msg, conversationHistory: [...history], channelType: 'whatsapp' as any },
                hasActions
                    ? { disableTools: false, evalMode: true, sandboxContactId: EVAL_SANDBOX_CONTACT_ID }
                    : { disableTools: true },
            );
            const reply = res?.reply || '';
            lines.push(`Cliente: ${msg}`, `Agente: ${reply}`);
            history.push({ role: 'user', content: msg }, { role: 'assistant', content: reply });
        }
        let transcript = lines.join('\n');
        if (sc.criteria) transcript += `\n\n[Criterio esperado para esta conversación: ${sc.criteria}]`;
        const judge = await this.quality.judgeTranscript(tenantId, transcript);
        const score = typeof judge.overall === 'number' ? judge.overall : 0;

        let actionsPassed = true;
        let actionChecks: any[] | undefined;
        if (hasActions) {
            const v = await this.verifyActions(schema, sc.expectedActions, EVAL_SANDBOX_CONTACT_ID);
            actionsPassed = v.passed;
            actionChecks = v.checks;
            await this.cleanupSandbox(schema); // rollback — no residue in the tenant DB
        }
        return { score, passed: score >= threshold && actionsPassed, actionChecks };
    }

    /** Assert each expected DB side-effect, scoped strictly to the sandbox contact. */
    private async verifyActions(schema: string, expected: ExpectedAction[], contactId: string): Promise<{ passed: boolean; checks: any[] }> {
        const checks: any[] = [];
        for (const a of expected || []) {
            if (!VERIFIABLE_TABLES.has(a.table)) {
                checks.push({ ok: false, description: a.description || a.table, detail: 'tabla no permitida' });
                continue;
            }
            const conds = ['contact_id = $1::uuid'];
            const params: any[] = [contactId];
            for (const [col, raw] of Object.entries(a.where || {})) {
                if (!/^[a-z_][a-z0-9_]*$/i.test(col)) continue; // safe identifier only (no injection)
                const m: any = (raw && typeof raw === 'object' && 'op' in (raw as any)) ? raw : { op: 'eq', value: raw };
                const i = params.length + 1;
                switch (m.op) {
                    case 'ilike': conds.push(`${col} ILIKE $${i}`); params.push(m.value); break;
                    case 'date_eq': conds.push(`DATE(${col}) = $${i}::date`); params.push(m.value); break;
                    case 'time_eq': conds.push(`to_char(${col}, 'HH24:MI') = $${i}`); params.push(m.value); break;
                    default: conds.push(`${col} = $${i}`); params.push(m.value);
                }
            }
            // A failing verification query (e.g. a column that doesn't exist) must NOT
            // silently become cnt=0 — that would turn a `no_row` assertion into a false
            // pass. Mark the check failed with the error instead.
            let rows: any[] | null;
            try {
                rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                    `SELECT COUNT(*)::int AS cnt FROM "${schema}".${a.table} WHERE ${conds.join(' AND ')}`, params);
            } catch (e: any) {
                checks.push({ ok: false, description: a.description || `${a.type} ${a.table}`, detail: `query error: ${e.message}` });
                continue;
            }
            const cnt = Number(rows?.[0]?.cnt || 0);
            let ok: boolean;
            if (a.type === 'no_row') ok = cnt === 0;
            else if (a.type === 'row_count') ok = cnt === (a.count ?? 1);
            else ok = cnt >= 1;
            checks.push({ ok, description: a.description || `${a.type} ${a.table}`, detail: `cnt=${cnt}` });
        }
        return { passed: checks.every(c => c.ok), checks };
    }

    private async ensureSandboxContact(schema: string): Promise<void> {
        // contacts.external_id is NOT NULL (unique per channel_type); omitting it makes
        // the INSERT fail (23502) → the sandbox contact never exists → appointments FK
        // violation → the whole action-verification gate becomes a no-op. Provide a
        // dedicated (channel_type, external_id) pair and surface failures (don't swallow).
        try {
            await this.prisma.executeInTenantSchema(schema,
                `INSERT INTO contacts (id, external_id, channel_type, name, phone, created_at, updated_at)
                 VALUES ($1::uuid, 'eval-sandbox', 'web_widget', 'Eval Sandbox', 'eval-sandbox-0000', NOW(), NOW())
                 ON CONFLICT (id) DO NOTHING`,
                [EVAL_SANDBOX_CONTACT_ID]);
        } catch (e: any) {
            this.logger.warn(`[Eval] ensureSandboxContact failed: ${e.message}`);
        }
    }

    /** Delete the sandbox contact's rows from the verifiable tables (deterministic rollback). */
    private async cleanupSandbox(schema: string): Promise<void> {
        for (const t of VERIFIABLE_TABLES) {
            await this.prisma.executeInTenantSchema(schema,
                `DELETE FROM "${schema}".${t} WHERE contact_id = $1::uuid`, [EVAL_SANDBOX_CONTACT_ID]).catch(() => {});
        }
    }

    private async persistRun(schema: string, agentId: string, result: any, trigger: string): Promise<void> {
        try {
            await this.prisma.executeInTenantSchema(schema,
                `INSERT INTO eval_runs (agent_id, k, threshold, passed, avg_score, eval_activable, results, trigger, created_at)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW())`,
                [agentId, result.k, result.threshold, result.passed, result.avgScore, result.evalActivable, JSON.stringify(result.scenarios), trigger]);
        } catch (e: any) {
            this.logger.warn(`[Eval] persist run failed: ${e.message}`);
        }
    }

    /** Recent eval runs (for the dashboard). */
    async listRuns(tenantId: string, agentId?: string): Promise<any[]> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTable(schema);
        const cols = `id, agent_id, k, threshold, passed, avg_score, eval_activable, trigger, created_at`;
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            agentId
                ? `SELECT ${cols} FROM eval_runs WHERE agent_id = $1::uuid ORDER BY created_at DESC LIMIT 50`
                : `SELECT ${cols} FROM eval_runs ORDER BY created_at DESC LIMIT 50`,
            agentId ? [agentId] : []);
        return rows || [];
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
