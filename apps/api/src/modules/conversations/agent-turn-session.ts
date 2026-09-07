import type { EvalNamespaceLease } from '../simulation/isolated-eval-namespace';
import { randomUUID } from 'crypto';
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
        this.inputTokens += response?.usage?.promptTokens ?? response?.usage?.inputTokens ?? response?.usage?.prompt_tokens ?? 0;
        this.outputTokens += response?.usage?.completionTokens ?? response?.usage?.outputTokens ?? response?.usage?.completion_tokens ?? 0;
        this.cost += response?.cost ?? 0;
        this.model = response?.modelUsed || response?.model || this.model;
    }
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
        if (existing && (existing.snapshot.configHash !== input.snapshot.configHash || existing.snapshot.learningReleaseId !== input.snapshot.learningReleaseId)) throw new Error('agent_test_session_revision_changed');
        if (!existing && this.sessions.size >= 1000) this.sessions.delete(this.sessions.keys().next().value!);
        const session: AgentTurnSession = existing || { ...input, id, state: new EphemeralTurnState(), metadata: {},
            lastMessageAt: new Date().toISOString(), trace: new AgentTurnTrace() };
        session.disableTools = input.disableTools;
        session.history = input.history;
        session.beforeToolExecution = input.beforeToolExecution;
        session.beforeModelExecution = input.beforeModelExecution;
        session.trace = new AgentTurnTrace();
        this.sessions.set(id, { session, expires: Date.now() + 3600_000 });
        return session;
    }
}
