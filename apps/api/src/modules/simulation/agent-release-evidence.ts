import { buildDomainContractDraft, composeSubtypeEvalPack, CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES,
    listCanonicalSubtypeExperienceProfileIds, type AddressForm } from '@parallext/shared';
import { evidenceIsValid, releaseScenarioDefinition, releaseScenarioPassed, type AgentReleaseRunEvidence } from './agent-release-policy';

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

/** Current authority must be supplied by the snapshot reader, never inferred from a past run. */
export interface IntentEvidenceScope {
    agentId: string;
    dependencyRevision: string;
    configHash: string;
    profileId: string;
    channels: readonly string[];
    languages: readonly string[];
}

export async function readSealedRunEvidence(
    query: <R = any[]>(sql: string, params?: any[]) => Promise<R>,
    schema: string, agentId: string, limit = 50,
): Promise<readonly { evidence: AgentReleaseRunEvidence; agentVersion: number | null }[]> {
    const [present] = await query<any[]>('SELECT to_regclass($1)::text AS name', [`${schema}.eval_runs`]);
    if (!present?.name) return Object.freeze([]);
    // A run whose learning release was withdrawn keeps its transcripts and stops
    // being proof. The column is asked for rather than assumed: this function
    // already tolerates a tenant with no `eval_runs` at all, so it must also
    // tolerate one whose table predates the mark.
    const columns = await query<any[]>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'eval_runs'`, [schema]);
    const marked = columns.some(column => String(column.column_name) === 'invalidated_at');
    const rows = await query<any[]>(
        `SELECT release_evidence, agent_snapshot FROM eval_runs
          WHERE agent_id = $1::uuid AND release_evidence IS NOT NULL
            ${marked ? 'AND invalidated_at IS NULL' : ''}
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
    runs: readonly { evidence: AgentReleaseRunEvidence; agentVersion: number | null }[],
    scope?: IntentEvidenceScope): IntentEvidence {
    const relevant = runs.filter(run => evidenceIsValid(run.evidence) && run.evidence.scenarios.some((scenario: any) =>
        typeof scenario?.managedSeedKey === 'string' && scenario.managedSeedKey.startsWith(`intent_${intentKey}_`)));
    const older = relevant.some(run => currentAgentVersion === null || run.agentVersion !== currentAgentVersion);
    // Version alone does not identify knowledge, tool policy, channel or scenario
    // definitions. A caller without the current snapshot cannot certify a task.
    if (!scope || !/^[a-f0-9]{64}$/.test(scope.configHash) || !/^[a-f0-9]{64}$/.test(scope.dependencyRevision)
        || !listCanonicalSubtypeExperienceProfileIds().includes(scope.profileId)
        || !scope.channels.length || scope.channels.some(channel => !(CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel))
        || !scope.languages.length || scope.languages.some(language => !(EVAL_LANGUAGES as readonly string[]).includes(language))) {
        return older ? 'stale' : 'not_verified';
    }
    const [industry, subtype] = scope.profileId.split('/');
    if (!buildDomainContractDraft(industry, subtype).intents.some(intent => intent.key === intentKey)) return 'not_verified';
    const matchingAgent = relevant.filter(run => run.evidence.agentId === scope.agentId);
    const current = matchingAgent.filter(run => currentAgentVersion !== null && run.agentVersion === currentAgentVersion
        && run.evidence.configHash === scope.configHash && run.evidence.dependencyRevision === scope.dependencyRevision);
    let required = 0, proven = 0;
    for (const language of [...new Set(scope.languages)]) {
        const expected = new Map<string, Set<string>>();
        for (const addressForm of (language === 'es' ? [null, 'tu', 'usted', 'vos'] : [null]) as Array<AddressForm | null>) {
            for (const scenario of composeSubtypeEvalPack({ industry, subtype, language, addressForm })) {
                if (!scenario.key.startsWith(`intent_${intentKey}_`)) continue;
                const definitions = expected.get(scenario.key) ?? new Set<string>();
                definitions.add(releaseScenarioDefinition(scenario));
                expected.set(scenario.key, definitions);
            }
        }
        for (const channel of [...new Set(scope.channels)]) {
            for (const [key, definitions] of expected) {
                required++;
                const matching = current.filter(run => run.evidence.channelType === channel).flatMap(run =>
                    run.evidence.scenarios.filter((scenario: any) => scenario.profileId === scope.profileId
                        && scenario.language === language && scenario.managedSeedKey === key
                        && definitions.has(releaseScenarioDefinition(scenario)))
                        .map((scenario: any) => ({ scenario, evidence: run.evidence })));
                if (matching.some(({ scenario, evidence }) => !releaseScenarioPassed(scenario, evidence))) return 'failed';
                if (matching.some(({ scenario, evidence }) => releaseScenarioPassed(scenario, evidence))) proven++;
            }
        }
    }
    if (required > 0 && proven === required) return 'verified';
    if (!current.length && matchingAgent.some(run => run.agentVersion !== currentAgentVersion
        || run.evidence.configHash !== scope.configHash || run.evidence.dependencyRevision !== scope.dependencyRevision)) return 'stale';
    return 'not_verified';
}
