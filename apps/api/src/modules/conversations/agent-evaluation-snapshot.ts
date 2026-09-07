import { createHash } from 'crypto';
import type { TenantConfig } from '@parallext/shared';

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
    return JSON.stringify(value);
}

/** Trusted server snapshot: never accepted through the public test DTO. */
export interface AgentEvaluationSnapshot {
    tenantId: string;
    agentId: string;
    version: number | null;
    capturedAt: string;
    configHash: string;
    config: TenantConfig;
    learningReleaseId?: string | null;
    learningReleaseHash?: string | null;
}
export function evaluationSnapshot(tenantId: string, agentId: string, agent: { version?: number; config_json?: unknown }, capturedAt = new Date().toISOString()): AgentEvaluationSnapshot {
    if (!agent?.config_json || typeof agent.config_json !== 'object') throw new Error('agent_config_snapshot_unavailable');
    const config = JSON.parse(JSON.stringify(agent.config_json));
    return { tenantId, agentId, version: agent.version ?? null, capturedAt, configHash: createHash('sha256').update(canonicalJson(config)).digest('hex'), config };
}
export function resolveEvaluationSnapshot(snapshot: AgentEvaluationSnapshot, tenantId: string, agentId: string): TenantConfig {
    if (snapshot.tenantId !== tenantId || snapshot.agentId !== agentId) throw new Error('agent_snapshot_scope_mismatch');
    const copy = evaluationSnapshot(tenantId, agentId, { version: snapshot.version ?? undefined, config_json: snapshot.config }, snapshot.capturedAt);
    if (copy.configHash !== snapshot.configHash) throw new Error('agent_snapshot_integrity_mismatch');
    return copy.config;
}
