import { disposeOwnedEvalNamespace, type EvalNamespaceLease } from './isolated-eval-namespace';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';

export type SimulationReplayQuery = <T = any[]>(sql: string, params?: any[]) => Promise<T>;

/** Caller holds the exclusive agent-privacy fence. Clear every copy, including baseline descendants. */
export async function retireSimulationReplayRuns(query: SimulationReplayQuery, input: {
    runIds?: string[]; contactIds?: string[]; legacy?: boolean;
    /** Collect only. The owner releases these AFTER this transaction/fence commits. */
    retiredSnapshots?: AgentEvaluationSnapshot[];
}): Promise<number> {
    const columns = await query<any[]>(`SELECT column_name FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='simulation_runs'`);
    const names = new Set(columns.map(row => row.column_name));
    if (!names.has('replay_authority')) {
        if (!input.legacy || !names.has('scenario_source')) return 0;
        // Older rows have no defensible source index; remove unknown lineage before the lazy migration too.
        const removed=await query<any[]>(`WITH RECURSIVE affected(id) AS (
            SELECT id FROM simulation_runs WHERE scenario_source='replay'
                OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(results,'[]'::jsonb)) s
                    WHERE s->>'source'='replay' OR s->>'key' LIKE 'replay:%')
            UNION SELECT r.id FROM simulation_runs r JOIN affected a ON r.baseline_run_id=a.id
        ) DELETE FROM simulation_runs WHERE id IN (SELECT id FROM affected)
            RETURNING id,${names.has('evaluation_snapshot')?'evaluation_snapshot':'NULL AS evaluation_snapshot'}`);
        for (const row of removed) if (row.evaluation_snapshot) input.retiredSnapshots?.push(row.evaluation_snapshot);
        return removed.length;
    }
    const rows = await query<any[]>(`WITH RECURSIVE affected(id) AS (
        SELECT r.id FROM simulation_runs r WHERE r.id=ANY($1::uuid[])
            OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.replay_authority,'[]'::jsonb)) a
                WHERE a->>'contactId'=ANY($2::text[]) OR a->>'originRunId'=ANY($1::text[]))
            OR ($3::boolean AND r.replay_authority IS NULL AND (r.scenario_source='replay'
                OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.results,'[]'::jsonb)) s
                    WHERE s->>'source'='replay' OR s->>'key' LIKE 'replay:%')))
        UNION
        SELECT r.id FROM simulation_runs r JOIN affected a ON r.baseline_run_id=a.id
    ) SELECT id,${names.has('replay_namespace_leases')?'replay_namespace_leases':'NULL AS replay_namespace_leases'},
        ${names.has('evaluation_snapshot')?'evaluation_snapshot':'NULL AS evaluation_snapshot'}
        FROM simulation_runs WHERE id IN (SELECT id FROM affected) AND status<>'retired' FOR UPDATE`,
    [input.runIds || [], input.contactIds || [], !!input.legacy]);
    if (!rows.length) return 0;
    const [{schema}] = await query<any[]>(`SELECT current_schema() AS schema`);
    for (const row of rows) for (const lease of (row.replay_namespace_leases || []) as EvalNamespaceLease[]) {
        if (lease.sourceSchema!==schema) throw new Error('simulation_replay_namespace_scope_mismatch');
        await disposeOwnedEvalNamespace(query,lease);
    }
    if (rows.length) await query(`UPDATE simulation_runs SET status='retired',results='[]'::jsonb,scenario_definitions=NULL,
        replay_authority=NULL,summary=NULL,persona_snapshot=NULL,evaluation_snapshot=NULL,
        ${names.has('replay_namespace_leases')?'replay_namespace_leases=NULL,':''}
        avg_score=NULL,resolved_rate=NULL,error='simulation_replay_source_unavailable',
        retired_at=COALESCE(retired_at,NOW()),completed_at=COALESCE(completed_at,NOW())
        WHERE id=ANY($1::uuid[])`, [rows.map(row=>row.id)]);
    for (const row of rows) if (row.evaluation_snapshot) input.retiredSnapshots?.push(row.evaluation_snapshot);
    return rows.length;
}

export async function eraseSimulationContactReplays(query: SimulationReplayQuery, contactIds: string[]): Promise<number> {
    // Unknown historical lineage cannot be proved unrelated to this erasure.
    return retireSimulationReplayRuns(query, {contactIds, legacy: true});
}
