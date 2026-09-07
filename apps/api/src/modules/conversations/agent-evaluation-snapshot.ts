import { createHash } from 'crypto';
import type { TenantConfig, ProcedureDefinition } from '@parallext/shared';
import type { AgentReleaseScope } from '../simulation/agent-release-policy';
import type { AgentConfigurationBody } from '../persona/agent-configuration-revision';
import { assertRevisionIntegrity, revisionHash, sealRevision, type EvaluationRevisionManifest } from '../evaluation-revision/evaluation-revision';

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
    configurationRevisionId?: string;
    configurationRevisionHash?: string;
    configurationBaseOperationalHash?: string;
    /** Private before-state for a deterministic review projection; never return raw tool credentials. */
    configurationBaseOperationalBody?: AgentConfigurationBody;
    releaseScope?: AgentReleaseScope;
    learningReleaseId?: string | null;
    learningReleaseHash?: string | null;
    manifest?: EvaluationRevisionManifest;
    /** Reviewed definitions are frozen; executing remote MCP effects remains unsupported in evaluations. */
    mcpTools?: any[];
    mcpToolsHash?: string;
    procedures?: ProcedureDefinition[];
    proceduresHash?: string;
    runtimeInputs?: { providerHealth: Record<string, any>; planFeatures: Record<string, any>; llmSpendUsdCents: number;
        mcpDiscoveredCount: number; mcpApprovedCount: number };
    runtimeInputsHash?: string;
}
export function evaluationSnapshot(tenantId: string, agentId: string, agent: { version?: number; config_json?: unknown }, capturedAt = new Date().toISOString()): AgentEvaluationSnapshot {
    if (!agent?.config_json || typeof agent.config_json !== 'object') throw new Error('agent_config_snapshot_unavailable');
    const config = JSON.parse(JSON.stringify(agent.config_json));
    return { tenantId, agentId, version: agent.version ?? null, capturedAt, configHash: createHash('sha256').update(canonicalJson(config)).digest('hex'), config };
}

function frozenDependencies(snapshot: AgentEvaluationSnapshot) {
    return [
        {key:'frozen.config',state:'present' as const,hash:revisionHash({agentId:snapshot.agentId,version:snapshot.version,configHash:snapshot.configHash,capturedAt:snapshot.capturedAt})},
        {key:'frozen.mcp_definitions',state:'present' as const,hash:revisionHash(snapshot.mcpTools || [])},
        {key:'frozen.procedures',state:'present' as const,hash:revisionHash(snapshot.procedures || [])},
        {key:'frozen.runtime_inputs',state:'present' as const,hash:revisionHash(snapshot.runtimeInputs)},
        {key:'frozen.learning_selection',state:'present' as const,hash:revisionHash({id:snapshot.learningReleaseId,hash:snapshot.learningReleaseHash})},
        ...(snapshot.releaseScope?[{key:'frozen.release_scope',state:'present' as const,hash:revisionHash(snapshot.releaseScope)}]:[]),
        ...(snapshot.configurationRevisionId?[{key:'frozen.configuration_revision',state:'present' as const,
            hash:revisionHash({id:snapshot.configurationRevisionId,hash:snapshot.configurationRevisionHash,
                baseOperationalHash:snapshot.configurationBaseOperationalHash,baseOperationalBody:snapshot.configurationBaseOperationalBody})}]:[]),
    ];
}

/** Only the trusted capture or candidate-selection path seals a new private snapshot. */
export function sealEvaluationSnapshot(snapshot: AgentEvaluationSnapshot): void {
    assertRevisionIntegrity(snapshot.manifest);
    snapshot.manifest = sealRevision(snapshot.tenantId,[...snapshot.manifest.dependencies.filter(item=>!item.key.startsWith('frozen.')),
        ...frozenDependencies(snapshot)],snapshot.manifest.exclusions);
}

export function resolveEvaluationSnapshot(snapshot: AgentEvaluationSnapshot, tenantId: string, agentId: string): TenantConfig {
    if (snapshot.tenantId !== tenantId || snapshot.agentId !== agentId) throw new Error('agent_snapshot_scope_mismatch');
    const copy = evaluationSnapshot(tenantId, agentId, { version: snapshot.version ?? undefined, config_json: snapshot.config }, snapshot.capturedAt);
    if (copy.configHash !== snapshot.configHash) throw new Error('agent_snapshot_integrity_mismatch');
    if (snapshot.manifest) {
        assertRevisionIntegrity(snapshot.manifest);
        if (snapshot.manifest.dependencies.some(item=>item.key==='frozen.release_scope') !== !!snapshot.releaseScope)
            throw new Error('agent_snapshot_release_scope_integrity_mismatch');
        if (snapshot.manifest.dependencies.some(item=>item.key==='frozen.configuration_revision') !== !!snapshot.configurationRevisionId
            ||!!snapshot.configurationRevisionId!==!!snapshot.configurationRevisionHash
            ||!!snapshot.configurationRevisionId!==!!snapshot.configurationBaseOperationalHash
            ||!!snapshot.configurationRevisionId!==!!snapshot.configurationBaseOperationalBody)
            throw new Error('agent_snapshot_configuration_revision_integrity_mismatch');
        if(snapshot.configurationRevisionId&&revisionHash({agentId:snapshot.agentId,version:snapshot.version,...snapshot.configurationBaseOperationalBody})!==snapshot.configurationBaseOperationalHash)
            throw new Error('agent_snapshot_configuration_base_integrity_mismatch');
        if (snapshot.manifest.tenantId !== tenantId) throw new Error('agent_snapshot_scope_mismatch');
        if (revisionHash(snapshot.mcpTools || []) !== snapshot.mcpToolsHash) throw new Error('agent_snapshot_mcp_integrity_mismatch');
        if (revisionHash(snapshot.procedures || []) !== snapshot.proceduresHash) throw new Error('agent_snapshot_procedure_integrity_mismatch');
        if (!snapshot.runtimeInputs || revisionHash(snapshot.runtimeInputs) !== snapshot.runtimeInputsHash) throw new Error('agent_snapshot_runtime_inputs_integrity_mismatch');
        if (frozenDependencies(snapshot).some(input => !snapshot.manifest!.dependencies.some(item=>item.key===input.key&&item.hash===input.hash)))
            throw new Error('agent_snapshot_frozen_dependencies_integrity_mismatch');
    }
    return copy.config;
}
