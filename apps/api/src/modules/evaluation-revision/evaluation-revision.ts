import { createHash } from 'crypto';

export function revisionHash(value: unknown): string {
    const canonical = (input: any): string => Array.isArray(input) ? `[${input.map(canonical).join(',')}]`
        : input && typeof input === 'object' ? `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${canonical(input[key])}`).join(',')}}`
        : JSON.stringify(input);
    // Match durable JSON/JSONB transport: undefined object properties disappear, Dates become strings.
    const serialized = JSON.stringify(value);
    return createHash('sha256').update(serialized === undefined ? 'undefined' : canonical(JSON.parse(serialized))).digest('hex');
}

export interface EvaluationDependency {
    key: string;
    state: 'present' | 'absent';
    hash: string;
    rows?: number;
}

/** Signatures only. Config, prices, documents, credentials and customer data are never serialized here. */
export interface EvaluationRevisionManifest {
    version: 1;
    tenantId: string;
    revision: string;
    strategy: 'guarded_live_dependencies';
    dependencies: EvaluationDependency[];
    exclusions: string[];
    limitations: readonly string[];
}

export function sealRevision(tenantId: string, dependencies: EvaluationDependency[], exclusions: string[]): EvaluationRevisionManifest {
    const body = { version: 1 as const, tenantId, strategy: 'guarded_live_dependencies' as const,
        dependencies: dependencies.slice().sort((a,b) => a.key.localeCompare(b.key)), exclusions: exclusions.slice().sort(),
        limitations: ['provider_model_weights_not_versioned', 'external_tool_execution_not_certified', 'wall_clock_not_frozen'] };
    return { ...body, revision: revisionHash(body) };
}

export function assertRevisionIntegrity(manifest?: EvaluationRevisionManifest): asserts manifest is EvaluationRevisionManifest {
    if (!manifest || manifest.version !== 1 || !manifest.dependencies?.length) throw new Error('evaluation_revision_manifest_required');
    const { revision, ...body } = manifest;
    if (revisionHash(body) !== revision) throw new Error('evaluation_revision_integrity_mismatch');
}

/** Output/telemetry tables do not feed the agent. Everything else is included by default, including new catalogs. */
export const EVALUATION_OUTPUT_TABLES = new Set([
    'simulation_runs', 'eval_runs', 'eval_autorun_requests', 'eval_autorun_budget', 'eval_scenarios',
    'agent_config_proposals', 'conversation_traces', 'turn_traces', 'conversation_quality_scores',
    'agent_quality_snapshots', 'agent_quality_signals', 'analytics_events', 'daily_metrics',
    'kb_retrieval_log', 'kb_unanswered_queries', 'kb_feedback', 'kb_health_issues',
    'knowledge_conflict_scans',
    'whatsapp_webhook_events', 'whatsapp_message_logs', 'alert_history', 'dashboard_preferences',
    'crm_sync_log', 'integration_outbox', 'integration_webhook_inbox', 'integration_reconciliations',
    'calendar_sync_outbox', 'webhook_deliveries', 'vertical_migration_outbox',
]);

/** Retrieval counters and evaluation bookkeeping cannot invalidate their own run. Business fields stay included. */
export function revisionIgnoredColumns(table: string): readonly string[] {
    if (table === 'learning_releases') return ['evaluation', 'evaluation_status', 'updated_at'];
    if (['knowledge_documents', 'knowledge_embeddings', 'knowledge_resources', 'knowledge_chunks', 'faqs'].includes(table))
        return ['query_frequency', 'last_accessed_at', 'access_count', 'views', 'view_count', 'retrieval_count'];
    return [];
}
