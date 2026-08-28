import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AgentTestService } from '../conversations/agent-test.service';
import { QualityService } from '../quality/quality.service';
import {
    composeSubtypeEvalPack,
    EVAL_LANGUAGES,
    VERTICAL_DOMAIN_CONTRACT_VERSION,
    type AddressForm,
} from '@parallext/shared';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { EVAL_WRITER_SANDBOX_FAMILIES } from '../conversations/agent-test-tool-policy';
import { EVAL_SANDBOX_FIXTURE_IDS } from '../conversations/eval-writer-sandbox';

export type ActionAssertionType = 'row_exists' | 'row_count' | 'no_row';

/** A declarative assertion about a DB side-effect the agent should (or shouldn't) cause. */
export interface DatabaseExpectedAction {
    kind?: 'db_effect';
    type: ActionAssertionType;
    /** Verifier family. Legacy rows may omit it and are resolved by table. */
    family?: string;
    table: string;
    /** column → expected value, or { op:'eq'|'ilike'|'date_eq'|'time_eq', value }. */
    where?: Record<string, any>;
    count?: number;                 // for row_count
    description?: string;
}

export interface ToolCallExpectedAction {
    kind: 'tool_call';
    type: 'called' | 'not_called';
    tool: string;
    description?: string;
}

export type ExpectedAction = DatabaseExpectedAction | ToolCallExpectedAction;

export interface EvalScenarioInput {
    key: string;
    title: string;
    vertical?: string;
    language?: string;
    locale?: string;
    profileId?: string;
    contractVersion?: number;
    seedOrigin?: string;
    /** Human key owned by the managed seed; absent for user-authored rows. */
    managedSeedKey?: string;
    /** Active by default; legacy collisions can be retained outside the gate. */
    seedState?: 'active' | 'retired' | 'review_required';
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
const EVAL_SANDBOX_CHANNEL_ACCOUNT_ID = 'eval-sandbox';

/**
 * Extensible effect-verifier registry. A family enters only after its writer
 * honours evalMode and cleanup is proven. This replaces the anonymous table
 * allowlist that could not describe ownership columns or future verifiers.
 */
export const EVAL_EFFECT_VERIFIERS: Readonly<Record<string, {
    table: string;
    contactColumn: string;
}>> = Object.freeze(Object.fromEntries(
    Object.entries(EVAL_WRITER_SANDBOX_FAMILIES)
        .filter(([, family]) => family.status === 'audited' && !!family.contactColumn)
        .map(([name, family]) => [name, Object.freeze({
            table: family.table,
            contactColumn: family.contactColumn!,
        })]),
));

export const AGENT_EVAL_COMPLETED_EVENT = 'agent.eval.completed';
export const AGENT_EVAL_FAILED_EVENT = 'agent.eval.failed';

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
    private readonly seeded = new Set<string>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly agentTest: AgentTestService,
        private readonly quality: QualityService,
        private readonly redis: RedisService,
        private readonly eventEmitter: EventEmitter2,
        // Opcional para los specs que arman el servicio a mano. Ausente = trato
        // neutro, que es el default y no el rioplatense.
        @Optional() private readonly regionalProfile?: RegionalProfileService,
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
                    profile_id TEXT,
                    locale TEXT,
                    contract_version INT,
                    seed_origin TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                 )`);
            await this.prisma.executeInTenantSchema(schema,
                `ALTER TABLE eval_scenarios ADD COLUMN IF NOT EXISTS expected_actions JSONB NOT NULL DEFAULT '[]'::jsonb`);
            for (const ddl of [
                `ALTER TABLE eval_scenarios ADD COLUMN IF NOT EXISTS profile_id TEXT`,
                `ALTER TABLE eval_scenarios ADD COLUMN IF NOT EXISTS locale TEXT`,
                `ALTER TABLE eval_scenarios ADD COLUMN IF NOT EXISTS contract_version INT`,
                `ALTER TABLE eval_scenarios ADD COLUMN IF NOT EXISTS seed_origin TEXT`,
                `ALTER TABLE eval_scenarios ADD COLUMN IF NOT EXISTS managed_seed_key TEXT`,
                `ALTER TABLE eval_scenarios ADD COLUMN IF NOT EXISTS seed_state TEXT NOT NULL DEFAULT 'active'`,
            ]) {
                await this.prisma.executeInTenantSchema(schema, ddl);
            }
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
        const profile = await this.profileOf(tenantId);
        const seedSignature = [
            schema,
            profile.industry || '',
            profile.subtype || '',
            profile.locale || profile.language || 'es',
            profile.addressForm || 'neutral',
            VERTICAL_DOMAIN_CONTRACT_VERSION,
        ].join(':');
        if (!this.seeded.has(seedSignature)) {
            await this.migrateLegacyScenarios(schema, profile);
            await this.seedDefaults(schema, profile);
            this.seeded.add(seedSignature);
        }
        return this.fetch(schema);
    }

    /**
     * El perfil del tenant, para que el set dorado sea el suyo.
     *
     * Un fallo acá deja el pack universal, no lo apaga: cuatro escenarios
     * genéricos miden menos que cinco, pero cero no mide nada.
     */
    /**
     * Contra qué se mide este tenant: rubro, idioma y forma de trato.
     *
     * El idioma y el país **no se leían**, así que el set dorado se sembraba
     * siempre en español —y en español rioplatense— para los 76 perfiles, en
     * cualquier país. Un tenant brasileño medía a su agente con un cliente
     * simulado que escribía en español, y uno colombiano con uno que lo trataba
     * de `vos` mientras su agente habla de `usted`.
     *
     * El idioma sale de `tenants.language` y la forma de trato del **mismo
     * resolutor regional que usa producción**: no una tabla propia del banco de
     * pruebas, que es como se llega a medir contra reglas que el runtime no
     * aplica.
     */
    private async profileOf(tenantId: string): Promise<{
        industry?: string;
        subtype?: string;
        language?: string;
        locale?: string;
        addressForm?: AddressForm | null;
    }> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { industry: true, settings: true, language: true },
            });
            const config = (tenant?.settings as any)?.verticalConfig;
            const regional = this.regionalProfile
                ? await this.regionalProfile.resolve(tenantId).catch(() => null)
                : null;
            return {
                industry: config?.industry || tenant?.industry || undefined,
                subtype: config?.subType || undefined,
                language: tenant?.language || undefined,
                locale: regional?.locale?.value || tenant?.language || undefined,
                addressForm: (regional?.addressForm?.value as AddressForm) || null,
            };
        } catch (e: any) {
            this.logger.warn(`[Eval] profile lookup failed for ${tenantId}: ${e?.message}`);
            return {};
        }
    }

    /**
     * Versionless rows predate managed seed identity. They are never deleted.
     * Exact generated rows are retired; unrelated keys remain active custom
     * scenarios; ambiguous managed-key edits are retained as review_required
     * and excluded from gates until an owner explicitly saves/reactivates them.
     */
    private async migrateLegacyScenarios(
        schema: string,
        profile: {
            industry?: string;
            subtype?: string;
            language?: string;
            locale?: string;
            addressForm?: AddressForm | null;
        },
    ): Promise<void> {
        const legacy = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, key, title, vertical, language, messages, criteria
               FROM eval_scenarios
              WHERE contract_version IS NULL
                AND profile_id IS NULL
                AND seed_origin IS NULL`);
        if (!legacy?.length) return;

        const candidates = new Map<string, Set<string>>();
        const forms: Array<AddressForm | null> = [null, 'usted', 'tu', 'vos'];
        for (const language of EVAL_LANGUAGES) {
            const languageForms = language === 'es' ? forms : [null];
            for (const addressForm of languageForms) {
                for (const scenario of composeSubtypeEvalPack({
                    industry: profile.industry,
                    subtype: profile.subtype,
                    language,
                    locale: language,
                    addressForm,
                })) {
                    const bucket = candidates.get(scenario.key) || new Set<string>();
                    bucket.add(this.legacyScenarioFingerprint(scenario));
                    candidates.set(scenario.key, bucket);
                }
            }
        }

        for (const row of legacy) {
            const key = String(row.key || '');
            const exactManaged = candidates.get(key)?.has(this.legacyScenarioFingerprint(row)) === true;
            // Older derived packs used the source term/limit inside the key;
            // those cannot be reconstructed safely after terminology changes.
            // Keep them for review instead of guessing that they were untouched.
            const managedCollision = candidates.has(key)
                || /^(?:avoid_.+|limit_.+|intent_.+|profile_.+)$/i.test(key);
            const seedOrigin = exactManaged
                ? 'legacy_managed'
                : managedCollision
                    ? 'legacy_ambiguous'
                    : 'custom_legacy';
            const seedState = exactManaged
                ? 'retired'
                : managedCollision
                    ? 'review_required'
                    : 'active';
            await this.prisma.executeInTenantSchema(schema,
                `UPDATE eval_scenarios
                    SET seed_origin = $2, managed_seed_key = $3, seed_state = $4
                  WHERE id = $1::uuid
                    AND contract_version IS NULL
                    AND profile_id IS NULL
                    AND seed_origin IS NULL`,
                [row.id, seedOrigin, managedCollision ? key : null, seedState]);
        }
    }

    private legacyScenarioFingerprint(scenario: {
        title?: unknown;
        language?: unknown;
        messages?: unknown;
        criteria?: unknown;
    }): string {
        return JSON.stringify({
            title: String(scenario.title || ''),
            language: String(scenario.language || 'es').slice(0, 2).toLowerCase(),
            messages: Array.isArray(scenario.messages)
                ? scenario.messages.map(message => String(message))
                : [],
            criteria: String(scenario.criteria || ''),
        });
    }

    private async fetch(schema: string): Promise<any[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, key, title, vertical, language, locale, profile_id, contract_version,
                    seed_origin, managed_seed_key, seed_state, messages, criteria, expected_actions
               FROM eval_scenarios ORDER BY created_at`);
        return (rows || []).map(r => ({
            id: r.id, key: r.key, title: r.title, vertical: r.vertical, language: r.language,
            messages: Array.isArray(r.messages) ? r.messages : [],
            criteria: r.criteria || undefined,
            expectedActions: Array.isArray(r.expected_actions) ? r.expected_actions : [],
            locale: r.locale || undefined,
            profileId: r.profile_id || undefined,
            contractVersion: r.contract_version == null ? undefined : Number(r.contract_version),
            seedOrigin: r.seed_origin || undefined,
            managedSeedKey: r.managed_seed_key || undefined,
            seedState: r.seed_state || 'active',
        }));
    }

    async addScenario(tenantId: string, def: EvalScenarioInput): Promise<void> {
        if (!def?.key || !def?.title || !Array.isArray(def.messages) || !def.messages.length) {
            throw new BadRequestException('key, title and a non-empty messages[] are required');
        }
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTable(schema);
        await this.prisma.executeInTenantSchema(schema,
            `INSERT INTO eval_scenarios (key, title, vertical, language, locale, profile_id,
                                         contract_version, seed_origin, managed_seed_key, seed_state,
                                         messages, criteria, expected_actions)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb)
             ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, vertical = EXCLUDED.vertical,
                 language = EXCLUDED.language, locale = EXCLUDED.locale,
                 profile_id = EXCLUDED.profile_id, contract_version = EXCLUDED.contract_version,
                 seed_origin = EXCLUDED.seed_origin, managed_seed_key = EXCLUDED.managed_seed_key,
                 seed_state = EXCLUDED.seed_state, messages = EXCLUDED.messages, criteria = EXCLUDED.criteria,
                 expected_actions = EXCLUDED.expected_actions`,
            [def.key, def.title, def.vertical || null, def.language || 'es',
             def.locale || def.language || 'es', def.profileId || null,
             def.contractVersion || null, def.seedOrigin || 'custom', def.managedSeedKey || null,
             def.seedState || 'active',
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
        try {
            const scenarios = (await this.listScenarios(tenantId))
                .filter(scenario => (scenario.seedState || 'active') === 'active');
            if (!scenarios.length) {
                const result = { passed: true, avgScore: 0, threshold, total: 0, scenarios: [] };
                this.emitRunEvent(AGENT_EVAL_COMPLETED_EVENT, tenantId, agentId, 'completed');
                return result;
            }

            const out: EvalGateResult['scenarios'] = [];
            for (const sc of scenarios) {
                // A judge/provider error is not evidence that the agent scored
                // zero. Propagate it so the run fails observably.
                out.push(await this.runScenario(tenantId, agentId, sc));
            }
            const avg = out.length ? out.reduce((s, r) => s + r.score, 0) / out.length : 0;
            const avgScore = Math.round(avg * 100) / 100;
            const result = { passed: avgScore >= threshold, avgScore, threshold, total: out.length, scenarios: out };
            this.emitRunEvent(AGENT_EVAL_COMPLETED_EVENT, tenantId, agentId, 'completed');
            return result;
        } catch (e) {
            this.emitRunEvent(AGENT_EVAL_FAILED_EVENT, tenantId, agentId, 'failed');
            throw e;
        }
    }

    private async runScenario(tenantId: string, agentId: string, sc: any): Promise<EvalGateResult['scenarios'][number]> {
        const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        const lines: string[] = [];
        for (const msg of (sc.messages || []).slice(0, MAX_SCENARIO_MESSAGES)) {
            const res = await this.agentTest.test(
                tenantId, agentId,
                { message: msg, conversationHistory: [...history] },
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
            score: judge.overall,
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

        // Serialize gate runs per tenant: all agents share one sandbox contact, so two
        // concurrent runs (two agents, or a manual run racing an auto-run) would have
        // one's cleanupSandbox wipe the other's rows before its verifyActions. Fail-open
        // on a Redis hiccup (don't block the gate). Lock TTL is a safety net if we crash.
        const lockKey = `eval-gate-run:${tenantId}`;
        const gotLock = await this.redis.acquireLock(lockKey, 600).catch(() => true);
        if (!gotLock) {
            this.logger.warn(`[Eval] gate run skipped for ${tenantId} — another run in progress`);
            return { skipped: true, reason: 'gate_already_running' };
        }

        try {
            const schema = await this.prisma.getTenantSchemaName(tenantId);
            await this.ensureTable(schema);
            await this.ensureSandboxContact(schema);

            const scenarios = (await this.listScenarios(tenantId))
                .filter(scenario => (scenario.seedState || 'active') === 'active');
            const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
            const k = Math.max(1, Math.min(opts?.k ?? 1, MAX_K));
            const passPolicy = opts?.passPolicy ?? 'all';

            const out: any[] = [];
            for (const sc of scenarios) {
                const hasActions = Array.isArray(sc.expectedActions) && sc.expectedActions.length > 0;
                out.push(await this.runPassK(tenantId, agentId, schema, sc, k, passPolicy, threshold, hasActions));
            }

            const avgScore = out.length ? Math.round((out.reduce((s, r) => s + r.score, 0) / out.length) * 100) / 100 : 0;
            const passed = out.length > 0 && out.every(r => r.passed);
            const evalActivable = passed && avgScore >= (opts?.activationThreshold ?? threshold);
            const result = { passed, avgScore, threshold, k, passPolicy, total: out.length, scenarios: out, evalActivable };
            await this.persistRun(schema, agentId, result, opts?.trigger || 'manual');
            this.emitRunEvent(AGENT_EVAL_COMPLETED_EVENT, tenantId, agentId, 'completed');
            return result;
        } catch (e) {
            this.emitRunEvent(AGENT_EVAL_FAILED_EVENT, tenantId, agentId, 'failed');
            throw e;
        } finally {
            await this.redis.releaseLock(lockKey).catch(() => {});
        }
    }

    private emitRunEvent(
        event: typeof AGENT_EVAL_COMPLETED_EVENT | typeof AGENT_EVAL_FAILED_EVENT,
        tenantId: string,
        agentId: string,
        status: 'completed' | 'failed',
    ): void {
        try {
            this.eventEmitter.emit(event, { tenantId, agentId, runId: null, status });
        } catch (e: any) {
            this.logger.warn(`[Eval] could not emit ${event}: ${e.message}`);
        }
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
        let cleanupRequired = false;
        try {
            if (hasActions) {
                await this.cleanupSandbox(schema); // start from a clean slate
                cleanupRequired = true;
                await this.prepareSandboxFixtures(schema);
            }
            // A scenario that asserts side-effects runs on a real sandbox
            // conversation: the guard binds writes to one, and reads the customer's
            // latest inbound message to decide whether they confirmed.
            const sandboxConversationId = hasActions ? await this.ensureSandboxConversation(schema) : undefined;
            const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
            const lines: string[] = [];
            const observedToolCalls: Array<{ name: string; result: unknown }> = [];
            for (const msg of (sc.messages || []).slice(0, MAX_SCENARIO_MESSAGES)) {
                if (sandboxConversationId) {
                    await this.recordSandboxInbound(schema, sandboxConversationId, msg);
                }
                const res = await this.agentTest.test(
                    tenantId, agentId,
                    { message: msg, conversationHistory: [...history] },
                    hasActions
                        ? {
                            disableTools: false,
                            evalMode: true,
                            sandboxContactId: EVAL_SANDBOX_CONTACT_ID,
                            sandboxConversationId,
                        }
                        : { disableTools: true },
                );
                const reply = res?.reply || '';
                for (const call of res?.debug?.toolCalls || []) {
                    observedToolCalls.push({ name: call.name, result: call.result });
                }
                lines.push(`Cliente: ${msg}`, `Agente: ${reply}`);
                history.push({ role: 'user', content: msg }, { role: 'assistant', content: reply });
            }
            let transcript = lines.join('\n');
            if (sc.criteria) transcript += `\n\n[Criterio esperado para esta conversación: ${sc.criteria}]`;
            const judge = await this.quality.judgeTranscript(tenantId, transcript);
            const score = judge.overall;

            let actionsPassed = true;
            let actionChecks: any[] | undefined;
            if (hasActions) {
                const v = await this.verifyActions(
                    schema,
                    sc.expectedActions,
                    EVAL_SANDBOX_CONTACT_ID,
                    observedToolCalls,
                );
                actionsPassed = v.passed;
                actionChecks = v.checks;
            }
            return { score, passed: score >= threshold && actionsPassed, actionChecks };
        } finally {
            // A failed model/provider/judge call is precisely when residue used
            // to survive. Cleanup is unconditional once fixture setup starts;
            // cleanup failures are surfaced instead of turning into a green run.
            if (cleanupRequired) await this.cleanupSandbox(schema);
        }
    }

    /** Assert each expected DB side-effect, scoped strictly to the sandbox contact. */
    private async verifyActions(
        schema: string,
        expected: ExpectedAction[],
        contactId: string,
        observedToolCalls: ReadonlyArray<{ name: string; result: unknown }> = [],
    ): Promise<{ passed: boolean; checks: any[] }> {
        const checks: any[] = [];
        for (const a of expected || []) {
            if (a.kind === 'tool_call') {
                const matches = observedToolCalls.filter(call => call.name === a.tool);
                const ok = a.type === 'called' ? matches.length > 0 : matches.length === 0;
                checks.push({
                    ok,
                    description: a.description || `${a.type} ${a.tool}`,
                    detail: `calls=${matches.length}`,
                });
                continue;
            }

            const verifier = a.family
                ? EVAL_EFFECT_VERIFIERS[a.family]
                : Object.values(EVAL_EFFECT_VERIFIERS).find(candidate => candidate.table === a.table);
            if (!verifier || verifier.table !== a.table) {
                checks.push({
                    ok: false,
                    description: a.description || a.table,
                    detail: `verificador no auditado para familia=${a.family || 'legacy'} tabla=${a.table}`,
                });
                continue;
            }
            const conds = [`${verifier.contactColumn} = $1::uuid`];
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
        await this.prisma.executeInTenantSchema(schema,
            `INSERT INTO contacts (id, external_id, channel_type, name, phone, created_at, updated_at)
             VALUES ($1::uuid, 'eval-sandbox', 'web_widget', 'Eval Sandbox', 'eval-sandbox-0000', NOW(), NOW())
             ON CONFLICT (id) DO NOTHING`,
            [EVAL_SANDBOX_CONTACT_ID]);
    }

    /**
     * Deterministic catalog rows the model can discover through production read
     * tools before invoking a writer. Reserved UUIDs plus an ownership marker
     * make setup and cleanup reversible without matching user-facing names.
     */
    private async prepareSandboxFixtures(schema: string): Promise<void> {
        const f = EVAL_SANDBOX_FIXTURE_IDS;
        const marker = JSON.stringify({ evalSandbox: true });
        const statements: Array<[string, any[]]> = [
            [
                `INSERT INTO "${schema}".services
                    (id, name, description, duration_minutes, price, currency, is_active,
                     category, max_concurrent, metadata)
                 VALUES ($1::uuid, '[EVAL] Sandbox Service', 'Evaluation-only fixture', 30, 10,
                         'COP', true, 'eval', 5, $2::jsonb)
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true,
                     max_concurrent = EXCLUDED.max_concurrent, metadata = EXCLUDED.metadata`,
                [f.service, marker],
            ],
            [
                `INSERT INTO "${schema}".services
                    (id, name, description, duration_minutes, price, currency, is_active,
                     category, max_concurrent, metadata)
                 VALUES ($1::uuid, '[EVAL] Boarding Service', 'Evaluation-only fixture', 1440, 10,
                         'COP', true, 'guarderia', 5, $2::jsonb)
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true,
                     max_concurrent = EXCLUDED.max_concurrent, metadata = EXCLUDED.metadata`,
                [f.boardingService, marker],
            ],
            [
                `INSERT INTO "${schema}".properties
                    (id, name, description, city, max_guests, night_price, currency, is_active, metadata)
                 VALUES ($1::uuid, '[EVAL] Sandbox Property', 'Evaluation-only fixture', 'Eval City',
                         4, 100, 'COP', true, $2::jsonb)
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true,
                     metadata = EXCLUDED.metadata`,
                [f.property, marker],
            ],
            [
                `INSERT INTO "${schema}".tour_packages
                    (id, name, description, duration_type, duration_value, price, currency,
                     max_capacity, destination, is_active, metadata)
                 VALUES ($1::uuid, '[EVAL] Sandbox Tour', 'Evaluation-only fixture', 'hours', 2,
                         50, 'COP', 10, 'Eval City', true, $2::jsonb)
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true,
                     metadata = EXCLUDED.metadata`,
                [f.tourPackage, marker],
            ],
            [
                `INSERT INTO "${schema}".tour_inventory
                    (id, package_id, departure_date, departure_time, available_seats, total_seats,
                     is_active, notes)
                 VALUES ($1::uuid, $2::uuid, '2099-06-01'::date, '10:00'::time, 10, 10, true,
                         '[EVAL] fixture')
                 ON CONFLICT (id) DO UPDATE SET available_seats = 10, total_seats = 10,
                     is_active = true, notes = EXCLUDED.notes`,
                [f.tourInventory, f.tourPackage],
            ],
            [
                `INSERT INTO "${schema}".menu_items
                    (id, name, description, price, currency, is_available, is_active, metadata)
                 VALUES ($1::uuid, '[EVAL] Sandbox Menu Item', 'Evaluation-only fixture', 10,
                         'COP', true, true, $2::jsonb)
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_available = true,
                     is_active = true, metadata = EXCLUDED.metadata`,
                [f.menuItem, marker],
            ],
            [
                `INSERT INTO "${schema}".members
                    (id, contact_id, member_number, current_period_start, current_period_end,
                     class_credits_remaining, status, metadata)
                 VALUES ($1::uuid, $2::uuid, 'EVAL-SANDBOX', '2099-01-01'::date,
                         '2099-12-31'::date, 10, 'active', $3::jsonb)
                 ON CONFLICT (id) DO UPDATE SET contact_id = EXCLUDED.contact_id,
                     current_period_end = EXCLUDED.current_period_end, status = 'active',
                     class_credits_remaining = 10, metadata = EXCLUDED.metadata`,
                [f.member, EVAL_SANDBOX_CONTACT_ID, marker],
            ],
            [
                `INSERT INTO "${schema}".fitness_classes
                    (id, name, class_type, scheduled_at, duration_minutes, max_capacity,
                     available_spots, credits_required, is_cancelled, metadata)
                 VALUES ($1::uuid, '[EVAL] Sandbox Class', 'eval', '2099-06-01 10:00'::timestamp,
                         60, 20, 20, 1, false, $2::jsonb)
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, scheduled_at = EXCLUDED.scheduled_at,
                     available_spots = 20, is_cancelled = false, metadata = EXCLUDED.metadata`,
                [f.fitnessClass, marker],
            ],
            [
                `INSERT INTO "${schema}".courses
                    (id, name, slug, description, price, currency, subject, level, is_active, metadata)
                 VALUES ($1::uuid, '[EVAL] Sandbox Course', 'eval-sandbox-course',
                         'Evaluation-only fixture', 100, 'COP', 'eval', 'A1', true, $2::jsonb)
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug,
                     is_active = true, metadata = EXCLUDED.metadata`,
                [f.course, marker],
            ],
            [
                `INSERT INTO "${schema}".course_cohorts
                    (id, course_id, cohort_code, starts_at, ends_at, schedule, max_capacity,
                     available_seats, status, metadata)
                 VALUES ($1::uuid, $2::uuid, 'EVAL-2099', '2099-06-01'::date, '2099-06-30'::date,
                         'Mon 10:00', 20, 20, 'open', $3::jsonb)
                 ON CONFLICT (id) DO UPDATE SET course_id = EXCLUDED.course_id,
                     available_seats = 20, status = 'open', metadata = EXCLUDED.metadata`,
                [f.cohort, f.course, marker],
            ],
            [
                `INSERT INTO "${schema}".products
                    (id, name, description, category, price, currency, is_available, stock, metadata)
                 VALUES ($1::uuid, '[EVAL] Sandbox Product', 'Evaluation-only fixture', 'eval',
                         10, 'COP', true, 100, $2::jsonb)
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_available = true,
                     stock = 100, metadata = EXCLUDED.metadata`,
                [f.product, marker],
            ],
            [
                `INSERT INTO "${schema}".vehicles
                    (id, make, model, year, price_cents, currency, status, category, description)
                 VALUES ($1::uuid, '[EVAL]', 'Sandbox Vehicle', 2099, 1000, 'COP', 'available',
                         'eval', 'Evaluation-only fixture')
                 ON CONFLICT (id) DO UPDATE SET status = 'available', description = EXCLUDED.description`,
                [f.vehicle],
            ],
            [
                `INSERT INTO "${schema}".pets
                    (id, contact_id, name, species, is_active, metadata)
                 VALUES ($1::uuid, $2::uuid, '[EVAL] Sandbox Pet', 'dog', true, $3::jsonb)
                 ON CONFLICT (id) DO UPDATE SET contact_id = EXCLUDED.contact_id,
                     is_active = true, metadata = EXCLUDED.metadata`,
                [f.pet, EVAL_SANDBOX_CONTACT_ID, marker],
            ],
            [
                `INSERT INTO "${schema}".insurance_policies
                    (id, policy_number, contact_id, policyholder_name, monthly_premium, currency,
                     starts_at, ends_at, status, metadata)
                 VALUES ($1::uuid, 'EVAL-SANDBOX-POLICY', $2::uuid, 'Eval Policyholder', 10, 'COP',
                         '2099-01-01'::date, '2099-12-31'::date, 'active', $3::jsonb)
                 ON CONFLICT (id) DO UPDATE SET contact_id = EXCLUDED.contact_id,
                     status = 'active', metadata = EXCLUDED.metadata`,
                [f.insurancePolicy, EVAL_SANDBOX_CONTACT_ID, marker],
            ],
        ];
        for (const [sql, params] of statements) {
            await this.prisma.executeInTenantSchema(schema, sql, params);
        }
    }

    /** Delete the sandbox contact's rows from the verifiable tables (deterministic rollback). */
    private async cleanupSandbox(schema: string): Promise<void> {
        for (const verifier of Object.values(EVAL_EFFECT_VERIFIERS)) {
            await this.prisma.executeInTenantSchema(schema,
                `DELETE FROM "${schema}".${verifier.table} WHERE ${verifier.contactColumn} = $1::uuid`,
                [EVAL_SANDBOX_CONTACT_ID]);
        }
        // The conversation the writer needed to bind to, its messages, and the
        // execution ledger rows the guard wrote. Ordered child-first so foreign
        // keys never block the rollback.
        for (const sql of [
            `DELETE FROM "${schema}".tool_execution_ledger WHERE contact_id = $1::uuid`,
            `DELETE FROM "${schema}".messages WHERE conversation_id IN (
                 SELECT id FROM "${schema}".conversations WHERE contact_id = $1::uuid
             )`,
            `DELETE FROM "${schema}".conversations WHERE contact_id = $1::uuid`,
        ]) {
            await this.prisma.executeInTenantSchema(schema, sql, [EVAL_SANDBOX_CONTACT_ID]);
        }

        // Reserved id AND ownership marker are both required. Names are never
        // used as deletion selectors, so a tenant-authored catalog row cannot
        // be swept by an eval rollback.
        const f = EVAL_SANDBOX_FIXTURE_IDS;
        const fixtureDeletes: Array<[string, any[]]> = [
            [`DELETE FROM "${schema}".tour_inventory WHERE id = $1::uuid AND notes = '[EVAL] fixture'`, [f.tourInventory]],
            [`DELETE FROM "${schema}".course_cohorts WHERE id = $1::uuid AND metadata->>'evalSandbox' = 'true'`, [f.cohort]],
            [`DELETE FROM "${schema}".members WHERE id = $1::uuid AND metadata->>'evalSandbox' = 'true'`, [f.member]],
            [`DELETE FROM "${schema}".fitness_classes WHERE id = $1::uuid AND metadata->>'evalSandbox' = 'true'`, [f.fitnessClass]],
            [`DELETE FROM "${schema}".insurance_policies WHERE id = $1::uuid AND metadata->>'evalSandbox' = 'true'`, [f.insurancePolicy]],
            [`DELETE FROM "${schema}".pets WHERE id = $1::uuid AND metadata->>'evalSandbox' = 'true'`, [f.pet]],
            [`DELETE FROM "${schema}".vehicles WHERE id = $1::uuid AND description = 'Evaluation-only fixture'`, [f.vehicle]],
            [`DELETE FROM "${schema}".tour_packages WHERE id = $1::uuid AND metadata->>'evalSandbox' = 'true'`, [f.tourPackage]],
            [`DELETE FROM "${schema}".properties WHERE id = $1::uuid AND metadata->>'evalSandbox' = 'true'`, [f.property]],
            [`DELETE FROM "${schema}".menu_items WHERE id = $1::uuid AND metadata->>'evalSandbox' = 'true'`, [f.menuItem]],
            [`DELETE FROM "${schema}".products WHERE id = $1::uuid AND metadata->>'evalSandbox' = 'true'`, [f.product]],
            [`DELETE FROM "${schema}".courses WHERE id = $1::uuid AND metadata->>'evalSandbox' = 'true'`, [f.course]],
            [`DELETE FROM "${schema}".services WHERE id = $1::uuid AND metadata->>'evalSandbox' = 'true'`, [f.service]],
            [`DELETE FROM "${schema}".services WHERE id = $1::uuid AND metadata->>'evalSandbox' = 'true'`, [f.boardingService]],
        ];
        for (const [sql, params] of fixtureDeletes) {
            await this.prisma.executeInTenantSchema(schema, sql, params);
        }
    }

    /**
     * The sandbox conversation an audited writer can hang its operation off.
     *
     * The central guard binds every write to a conversation and to the inbound
     * message that requested it. Agent Test has neither, so the gate's writers
     * were rejected with `conversation_context_required` and every scenario with
     * expected actions failed for a reason that had nothing to do with the agent.
     */
    private async ensureSandboxConversation(schema: string): Promise<string | undefined> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `INSERT INTO conversations (contact_id, channel_type, channel_account_id, status, stage)
             VALUES ($1::uuid, 'web_widget', $2, 'active', 'greeting')
             RETURNING id::text`,
            [EVAL_SANDBOX_CONTACT_ID, EVAL_SANDBOX_CHANNEL_ACCOUNT_ID]);
        const conversationId = rows?.[0]?.id;
        if (!conversationId) throw new Error('eval_sandbox_conversation_not_created');
        return conversationId;
    }

    /**
     * Records the customer's line as a real inbound message.
     *
     * Not decoration: the confirmation guard reads the latest inbound message to
     * decide whether the customer consented, so a scenario that says "sí" must
     * have that "sí" on the conversation for the writer to be allowed through.
     */
    private async recordSandboxInbound(
        schema: string,
        conversationId: string,
        text: string,
    ): Promise<void> {
        await this.prisma.executeInTenantSchema(schema,
            `INSERT INTO messages (conversation_id, direction, content_type, content_text, status, created_at)
             VALUES ($1::uuid, 'inbound', 'text', $2, 'delivered', NOW())`,
            [conversationId, text]);
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
    /**
     * El set dorado inicial del tenant.
     *
     * Eran cuatro escenarios genéricos iguales para los 76 perfiles, y ninguno
     * tocaba lo que de verdad puede salir mal en cada rubro: abrir una venta
     * sobre un síntoma, prometerle una mesa a una cocina sin salón, o improvisar
     * sobre algo que el perfil declara que NO hace. Ahora los universales vienen
     * acompañados de un escenario por cada riesgo que el perfil **declara**
     * tener — ninguno inventado.
     */
    private async seedDefaults(
        schema: string,
        profile: {
            industry?: string;
            subtype?: string;
            language?: string;
            locale?: string;
            addressForm?: AddressForm | null;
        } = {},
    ): Promise<void> {
        const tenantLocale = String(profile.locale || profile.language || 'es');
        const tenantLanguage = tenantLocale.slice(0, 2).toLowerCase();
        const defaults: EvalScenarioInput[] = EVAL_LANGUAGES.flatMap(language => {
            const locale = language === tenantLanguage ? tenantLocale : language;
            return composeSubtypeEvalPack({
                industry: profile.industry,
                subtype: profile.subtype,
                language,
                locale,
                addressForm: language === 'es' ? profile.addressForm : null,
            }).map((scenario) => ({
                key: scenario.storageKey || scenario.key,
                title: scenario.title,
                vertical: profile.industry,
                language: scenario.language,
                locale: scenario.locale,
                profileId: scenario.profileId,
                contractVersion: scenario.contractVersion,
                seedOrigin: scenario.origin,
                managedSeedKey: scenario.key,
                seedState: 'active',
                messages: scenario.messages,
                criteria: scenario.criteria,
                expectedActions: (scenario.expectedActions || []) as ExpectedAction[],
            }));
        });
        // A tenant can change subtype or operating locale while the API stays
        // up. Keep earlier managed packs for audit, but retire them from the
        // gate. User-authored scenarios have no managed_seed_key and are never
        // touched by this policy.
        await this.prisma.executeInTenantSchema(schema,
            `UPDATE eval_scenarios
                SET seed_state = 'retired'
              WHERE contract_version IS NOT NULL
                AND managed_seed_key IS NOT NULL
                AND NOT (key = ANY($1::text[]))`,
            [defaults.map(scenario => scenario.key)]);
        for (const d of defaults) {
            await this.prisma.executeInTenantSchema(schema,
                `INSERT INTO eval_scenarios (key, title, vertical, language, locale, profile_id,
                                             contract_version, seed_origin, managed_seed_key, seed_state,
                                             messages, criteria, expected_actions)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb)
                 ON CONFLICT (key) DO UPDATE SET
                    title = EXCLUDED.title,
                    vertical = EXCLUDED.vertical,
                    language = EXCLUDED.language,
                    locale = EXCLUDED.locale,
                    profile_id = EXCLUDED.profile_id,
                    contract_version = EXCLUDED.contract_version,
                    seed_origin = EXCLUDED.seed_origin,
                    managed_seed_key = EXCLUDED.managed_seed_key,
                    seed_state = EXCLUDED.seed_state,
                    messages = EXCLUDED.messages,
                    criteria = EXCLUDED.criteria,
                    expected_actions = EXCLUDED.expected_actions`,
                [
                    d.key, d.title, d.vertical || null, d.language || 'es', d.locale || d.language || 'es',
                    d.profileId || null, d.contractVersion || null, d.seedOrigin || null,
                    d.managedSeedKey || null, d.seedState || 'active',
                    JSON.stringify(d.messages), d.criteria || null,
                    JSON.stringify(d.expectedActions || []),
                ]);
        }
    }
}
