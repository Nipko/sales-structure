import type { EvalNamespaceLease } from '../simulation/isolated-eval-namespace';
import { randomUUID } from 'crypto';
import { activeLlmCatalog } from '../ai/router/llm-catalog';
import { usageCostUsd } from '../ai/router/llm-cost';
import type { TestAgentToolCall, TurnContext } from '@parallext/shared';
import type { ServiceExecutionContext } from '../../common/types/execution-context';
import type { AgentEvaluationSnapshot } from './agent-evaluation-snapshot';

export interface TurnStateStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttl?: number): Promise<void>;
    del(key: string): Promise<void>;
    getJson<T>(key: string): Promise<T | null>;
    setJson(key: string, value: unknown, ttl?: number): Promise<void>;
}

/** Conversation state belongs to the session; no test state is shared with live Redis. */
export class EphemeralTurnState implements TurnStateStore {
    private readonly values = new Map<string, { value: string; expires: number }>();
    async get(key: string): Promise<string | null> {
        const row = this.values.get(key);
        if (!row || row.expires <= Date.now()) { this.values.delete(key); return null; }
        return row.value;
    }
    async set(key: string, value: string, ttl = 3600): Promise<void> {
        this.values.set(key, { value, expires: Date.now() + ttl * 1000 });
    }
    async del(key: string): Promise<void> { this.values.delete(key); }
    async getJson<T>(key: string): Promise<T | null> {
        const value = await this.get(key); return value === null ? null : JSON.parse(value);
    }
    async setJson(key: string, value: unknown, ttl = 3600): Promise<void> { await this.set(key, JSON.stringify(value), ttl); }
}

export interface AgentTurnSession {
    learningEvaluationSource?:import('../learning/learning-contracts').LearningEvaluationSourceScope;
    evaluationSourceAuthority?:import('../ai/interfaces/llm-source-authority').LLMSourceAuthority;
    evaluationDataSourceAuthority?:import('../ai/interfaces/external-source-authority').ExternalSourceAuthority;
    id: string;
    tenantId: string;
    agentId: string;
    channelType: string;
    conversationId: string;
    contactId: string;
    schemaName: string;
    sandboxNamespace?: EvalNamespaceLease;
    snapshot: AgentEvaluationSnapshot;
    executionContext: ServiceExecutionContext;
    mode: 'preview' | 'sandbox';
    state: TurnStateStore;
    metadata: Record<string, any>;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    lastMessageAt: string;
    beforeToolExecution?: () => Promise<void>;
    beforeModelExecution?: () => Promise<void>;
    afterDependencyRead?: () => Promise<void>;
    disableTools?: boolean;
    busy?: boolean;
    trace: AgentTurnTrace;
}

/** Observer only: it never determines authority, prompt contents or operation success. */
export class AgentTurnTrace {
    systemPrompt = '';
    turnContext?: TurnContext;
    toolCalls: TestAgentToolCall[] = [];
    advertisedTools: any[] = [];
    executableToolNames: string[] = [];
    inputTokens = 0;
    outputTokens = 0;
    cost = 0;
    model = '';
    providerCalls = 0;
    steps: unknown[] = [];
    error?: string;
    capability?: any;

    provider(response: any): void {
        const input = response?.usage?.promptTokens ?? response?.usage?.inputTokens ?? response?.usage?.prompt_tokens ?? 0;
        const output = response?.usage?.completionTokens ?? response?.usage?.outputTokens ?? response?.usage?.completion_tokens ?? 0;
        this.inputTokens += input;
        this.outputTokens += output;
        // OpenAI-compatible providers keep their actual model inside raw;
        // task routing also reports the candidate that really succeeded.
        // Requested configuration alone is not evidence of the served model.
        const reportedModel = [response?.modelUsed, response?.model, response?.raw?.model,
            response?.routingDecision?.selectedModel?.id]
            .find(value => typeof value === 'string' && value.trim().length > 0);
        if (reportedModel) this.model = reportedModel.trim();
        // The router prices each call for its own counters but does not return the figure, so a response
        // without `cost` is priced here from the same catalogue and the model that served it.
        const cached = Number(response?.usage?.cachedPromptTokens) || 0;
        const cacheWrite = Number(response?.usage?.cacheWritePromptTokens) || 0;
        this.cost += typeof response?.cost === 'number' ? response.cost : callCostUsd(reportedModel, input, output, cached, cacheWrite);
    }
}

/** USD of one call at catalogue rates; a dated snapshot («gpt-4o-mini-2024-07-18») is priced as its base model. */
export function callCostUsd(model: string | undefined, inputTokens: number, outputTokens: number, cachedInputTokens = 0, cacheWriteInputTokens = 0): number {
    const id = String(model ?? '').trim().toLowerCase();
    const rate = [...activeLlmCatalog().models].sort((a, b) => b.id.length - a.id.length)
        .find(m => id === m.id || id.startsWith(`${m.id}-`) || id.endsWith(`/${m.id}`));
    return rate ? usageCostUsd(rate, { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: 0,
        cachedPromptTokens: cachedInputTokens, cacheWritePromptTokens: cacheWriteInputTokens }) : 0;
}

interface StoredSession { session: AgentTurnSession; expires: number }

/** Session IDs are opaque and scoped to tenant, agent, channel and frozen config. */
export class AgentTurnSessionStore {
    private readonly sessions = new Map<string, StoredSession>();
    getSnapshot(id: string, tenantId: string, agentId: string): AgentEvaluationSnapshot {
        const stored = this.sessions.get(id);
        if (!stored || stored.expires <= Date.now()) throw new Error('agent_test_session_expired');
        if (stored.session.tenantId !== tenantId || stored.session.agentId !== agentId) throw new Error('agent_test_session_scope_mismatch');
        return structuredClone(stored.session.snapshot);
    }
    resolve(input: Omit<AgentTurnSession, 'id' | 'state' | 'metadata' | 'lastMessageAt' | 'trace'> & { id?: string }): AgentTurnSession {
        for (const [key, row] of this.sessions) if (row.expires <= Date.now()) this.sessions.delete(key);
        const id = input.id || randomUUID();
        const existing = this.sessions.get(id)?.session;
        if (existing?.busy) throw new Error('agent_test_session_busy');
        if (existing && (existing.tenantId !== input.tenantId || existing.agentId !== input.agentId
            || existing.channelType !== input.channelType || existing.mode !== input.mode || existing.contactId !== input.contactId || existing.schemaName !== input.schemaName || existing.sandboxNamespace?.token !== input.sandboxNamespace?.token)) throw new Error('agent_test_session_scope_mismatch');
        if (existing && (existing.snapshot.configHash !== input.snapshot.configHash || existing.snapshot.learningReleaseId !== input.snapshot.learningReleaseId
            || existing.snapshot.learningReleaseHash !== input.snapshot.learningReleaseHash || existing.snapshot.manifest?.revision !== input.snapshot.manifest?.revision
            || existing.snapshot.mcpToolsHash !== input.snapshot.mcpToolsHash || existing.snapshot.proceduresHash !== input.snapshot.proceduresHash
            || existing.snapshot.runtimeInputsHash !== input.snapshot.runtimeInputsHash
            || existing.snapshot.capturedAt !== input.snapshot.capturedAt)) throw new Error('agent_test_session_revision_changed');
        if (!existing && this.sessions.size >= 1000) this.sessions.delete(this.sessions.keys().next().value!);
        const session: AgentTurnSession = existing || { ...input, snapshot: structuredClone(input.snapshot), id, state: new EphemeralTurnState(), metadata: {},
            lastMessageAt: new Date().toISOString(), trace: new AgentTurnTrace() };
        session.disableTools = input.disableTools;
        session.history = input.history;
        session.beforeToolExecution = input.beforeToolExecution;
        session.beforeModelExecution = input.beforeModelExecution;
        session.learningEvaluationSource = input.learningEvaluationSource ? structuredClone(input.learningEvaluationSource) : undefined;
        session.evaluationSourceAuthority = input.evaluationSourceAuthority;
        session.evaluationDataSourceAuthority = input.evaluationDataSourceAuthority;
        session.afterDependencyRead = input.afterDependencyRead;
        session.trace = new AgentTurnTrace();
        const corpusExpiry = Date.parse(input.snapshot.knowledgeInputs?.usage?.expiresAt || '');
        this.sessions.set(id, { session, expires: Math.min(Date.now() + 3600_000,
            Number.isFinite(corpusExpiry) ? corpusExpiry : Infinity) });
        return session;
    }
}
