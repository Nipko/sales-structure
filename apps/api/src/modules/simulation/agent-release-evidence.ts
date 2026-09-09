import { evidenceIsValid, releaseScenarioPassed, type AgentReleaseRunEvidence } from './agent-release-policy';

/**
 * The sealed runs stored for an agent, read without going through the eval
 * service.
 *
 * The assessment has to be able to say whether a specific task was ever proven,
 * and it reported `evidence: 'not_verified'` as a hard-coded literal — the same
 * shape as the certification count that could never say anything but zero. A
 * plain function keeps that answer available without the assessment having to
 * depend on the evaluation service and the dependency cycle that would create.
 */

export type IntentEvidence = 'not_verified' | 'verified' | 'failed' | 'stale';

export async function readSealedRunEvidence(
    query: <R = any[]>(sql: string, params?: any[]) => Promise<R>,
    schema: string, agentId: string, limit = 50,
): Promise<readonly { evidence: AgentReleaseRunEvidence; agentVersion: number | null }[]> {
    const [present] = await query<any[]>('SELECT to_regclass($1)::text AS name', [`${schema}.eval_runs`]);
    if (!present?.name) return Object.freeze([]);
    const rows = await query<any[]>(
        `SELECT release_evidence, agent_snapshot FROM eval_runs
          WHERE agent_id = $1::uuid AND release_evidence IS NOT NULL
          ORDER BY created_at DESC LIMIT $2`, [agentId, Math.min(Math.max(limit, 1), 200)]);
    return Object.freeze(rows
        .map(row => ({
            evidence: row.release_evidence as AgentReleaseRunEvidence,
            agentVersion: Number(row.agent_snapshot?.version ?? row.agent_snapshot?.agentVersion) || null,
        }))
        .filter(entry => evidenceIsValid(entry.evidence)));
}

/**
 * Whether one task of the agent's mission was actually proven, and under which
 * version of it.
 *
 * A scenario belongs to an intent by the key the packs give it. Evidence from an
 * older revision of the agent is reported as stale rather than as proof: the
 * configuration that passed is not the configuration being assessed, and
 * treating them as one is how a screen ends up claiming a task works because it
 * used to.
 */
export function intentEvidence(intentKey: string, currentAgentVersion: number | null,
    runs: readonly { evidence: AgentReleaseRunEvidence; agentVersion: number | null }[]): IntentEvidence {
    const prefix = `intent_${intentKey}_`;
    let sawCurrent = false, sawOlder = false, failedCurrent = false;
    for (const run of runs) {
        const scenarios = (run.evidence.scenarios || []).filter((scenario: any) =>
            typeof scenario?.key === 'string' && scenario.key.startsWith(prefix));
        if (!scenarios.length) continue;
        const current = currentAgentVersion !== null && run.agentVersion === currentAgentVersion;
        if (!current) { sawOlder = true; continue; }
        sawCurrent = true;
        if (scenarios.some((scenario: any) => !releaseScenarioPassed(scenario, run.evidence))) failedCurrent = true;
    }
    if (failedCurrent) return 'failed';
    if (sawCurrent) return 'verified';
    if (sawOlder) return 'stale';
    return 'not_verified';
}
