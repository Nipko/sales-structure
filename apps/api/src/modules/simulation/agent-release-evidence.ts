import { buildDomainContractDraft, composeSubtypeEvalPack, CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES,
    listCanonicalSubtypeExperienceProfileIds, type AddressForm } from '@parallext/shared';
import { evidenceIsValid, releaseScenarioDefinition, releaseScenarioPassed, type AgentReleaseRunEvidence } from './agent-release-policy';
import { resolveEvaluationSnapshot, type AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { sealRevision, type EvaluationRevisionManifest } from '../evaluation-revision/evaluation-revision';

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

/**
 * The two spellings of the embedded chat surface, stated once.
 *
 * `CONVERSATIONAL_CHANNELS` names it `web_widget`; `web_chat` is the alias the
 * configuration surfaces and the guided-tour contract use. Two spellings of one
 * channel are two chances for a scope and its evidence to miss each other, so
 * both directions are derived from this one pair instead of from a ternary
 * written wherever the mismatch happened to hurt.
 */
export const WEB_CHAT_CHANNEL_ALIAS = Object.freeze({ alias: 'web_chat', canonical: 'web_widget' });

/**
 * The canonical channel an evidence scope is built and compared with.
 *
 * It never rewrites a stored run's own `channelType` or its `contextHash`, and
 * it never maps an unknown channel onto the widget.
 */
export function canonicalEvidenceChannel(channel: string): string {
    return channel === WEB_CHAT_CHANNEL_ALIAS.alias ? WEB_CHAT_CHANNEL_ALIAS.canonical : channel;
}

/** The alias spelling, for the contracts that name it instead of the canonical one. */
export function aliasedChannelSpelling(channel: string): string {
    return channel === WEB_CHAT_CHANNEL_ALIAS.canonical ? WEB_CHAT_CHANNEL_ALIAS.alias : channel;
}

/**
 * One stored run, with the durable identity the authority reader needs.
 *
 * `snapshot` is the private evaluation snapshot kept for validation only. It is
 * never projected into the assessment DTO: the reader uses it to check that the
 * run speaks for the configuration on screen and then drops it.
 */
export interface SealedRunCandidate {
    evidence: AgentReleaseRunEvidence;
    agentVersion: number | null;
    /** Durable row id, used to break ties in attempt order. */
    runId?: string | null;
    /** Durable timestamp of the persisted row, in epoch milliseconds. */
    recordedAt?: number | null;
    /** `false` only when a durable record says this result was rejected or withdrawn. */
    accepted?: boolean;
    /** Private `AgentEvaluationSnapshot` of the run; validation input, never output. */
    snapshot?: unknown;
    /**
     * Set by the authority reader: whether this run's own snapshot was validated
     * against the live capture.
     *
     * `false` keeps the run visible as history — which is what tells staleness
     * apart from absence — without letting it certify anything.
     */
    authorityVerified?: boolean;
}

/** Current authority must be supplied by the snapshot reader, never inferred from a past run. */
export interface IntentEvidenceScope {
    agentId: string;
    dependencyRevision: string;
    configHash: string;
    profileId: string;
    channels: readonly string[];
    languages: readonly string[];
    /**
     * Full manifest revisions an authority reader validated as still live.
     *
     * Two legitimate captures of one configuration differ in their frozen
     * inputs — `frozen.config` carries `capturedAt`, the knowledge replica
     * carries a lease id — so their complete revisions differ too. Demanding
     * equality with a single revision would refuse evidence that is current.
     * These are accepted in addition to `dependencyRevision`, and only an
     * authority reader that validated each snapshot may supply them.
     */
    currentDependencyRevisions?: readonly string[];
}

export async function readSealedRunEvidence(
    query: <R = any[]>(sql: string, params?: any[]) => Promise<R>,
    schema: string, agentId: string, limit = 50,
): Promise<readonly SealedRunCandidate[]> {
    const [present] = await query<any[]>('SELECT to_regclass($1)::text AS name', [`${schema}.eval_runs`]);
    if (!present?.name) return Object.freeze([]);
    // A run whose learning release was withdrawn keeps its transcripts and stops
    // being proof. The column is asked for rather than assumed: this function
    // already tolerates a tenant with no `eval_runs` at all, so it must also
    // tolerate one whose table predates the mark. The release evaluations table
    // is probed the same way — by the column, which answers existence too — and
    // it is what carries the executor's own acceptance of a result.
    const [capability] = await query<any[]>(
        `SELECT EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = 'eval_runs' AND column_name = 'invalidated_at') AS marked,
            EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = 'agent_release_evaluations' AND column_name = 'invalidated_at') AS releases`,
        [schema]);
    const marked = capability?.marked === true;
    // `bool_and` over no evaluation rows is NULL, which reads as "the release
    // executor did not produce this run" — an ordinary evaluation, not a
    // rejected one. Only an executor row that did not complete, or one that was
    // withdrawn, answers false.
    const acceptance = capability?.releases === true
        ? `, (SELECT bool_and(e.status = 'completed' AND e.invalidated_at IS NULL)
               FROM agent_release_evaluations e WHERE e.run_id = r.id) AS accepted`
        : '';
    const rows = await query<any[]>(
        `SELECT r.id, r.created_at, r.release_evidence, r.agent_snapshot${acceptance} FROM eval_runs r
          WHERE r.agent_id = $1::uuid AND r.release_evidence IS NOT NULL
            ${marked ? 'AND r.invalidated_at IS NULL' : ''}
          ORDER BY r.created_at DESC, r.id DESC LIMIT $2`, [agentId, Math.min(Math.max(limit, 1), 200)]);
    return Object.freeze(rows
        .map(row => ({
            evidence: row.release_evidence as AgentReleaseRunEvidence,
            agentVersion: Number(row.agent_snapshot?.version ?? row.agent_snapshot?.agentVersion) || null,
            runId: row.id === null || row.id === undefined ? null : String(row.id),
            recordedAt: durableInstant(row.created_at),
            accepted: row.accepted === null || row.accepted === undefined ? true : row.accepted === true,
            snapshot: row.agent_snapshot ?? null,
        }))
        .filter(entry => evidenceIsValid(entry.evidence)));
}

function durableInstant(value: unknown): number | null {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Durable order of one stored attempt.
 *
 * It comes from the persisted row — its timestamp, then its id — never from a
 * date a browser supplied. A candidate carrying neither sorts below every dated
 * result, so an undated row cannot displace one.
 */
function attemptOrder(run: SealedRunCandidate): string {
    const at = typeof run.recordedAt === 'number' && Number.isFinite(run.recordedAt)
        ? Math.max(0, Math.trunc(run.recordedAt)) : 0;
    return `${String(at).padStart(16, '0')}|${run.runId ?? ''}`;
}

/**
 * Which stored runs still speak for the configuration being assessed.
 *
 * The snapshot each run was produced under is preserved and re-validated; no
 * hash is copied from a run onto the scope, which would let the evidence declare
 * its own currency. Nothing here creates a knowledge replica, leases a namespace
 * or contacts an MCP server: `resolveEvaluationSnapshot` validates the preserved
 * snapshot, and the live half of its manifest is compared against the single
 * dependency capture the caller took.
 *
 * `currentDependencyRevisions` are the complete revisions of the snapshots that
 * passed, so each run keeps its own seal instead of being normalised onto one
 * artificial revision. Every candidate is returned, marked: a run that did not
 * pass is still history, and dropping it would spell "this was never proven"
 * where the honest answer is "what proved it is no longer current".
 */
export function admitSealedRunEvidence(input: {
    tenantId: string;
    agentId: string;
    agentVersion: number | null;
    configHash: string;
    current: EvaluationRevisionManifest;
    runs: readonly SealedRunCandidate[];
}): { runs: SealedRunCandidate[]; currentDependencyRevisions: string[] } {
    const revisions = new Set<string>();
    const runs = input.runs.map(run => ({ ...run, authorityVerified: verifiedAgainstCapture(run, input, revisions) }));
    return { runs, currentDependencyRevisions: [...revisions] };
}

function verifiedAgainstCapture(run: SealedRunCandidate, input: {
    tenantId: string; agentId: string; agentVersion: number | null; configHash: string; current: EvaluationRevisionManifest;
}, revisions: Set<string>): boolean {
    if (run.accepted === false) return false;
    const snapshot = run.snapshot as AgentEvaluationSnapshot | undefined | null;
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.manifest) return false;
    // Tenant and agent scope, configuration integrity and every frozen
    // fingerprint. A snapshot of another agent or of an edited draft throws.
    try { resolveEvaluationSnapshot(snapshot, input.tenantId, input.agentId); } catch { return false; }
    if (input.agentVersion === null || Number(snapshot.version) !== input.agentVersion) return false;
    if (snapshot.configHash !== input.configHash) return false;
    // The run has to be the one this snapshot produced, not another run filed
    // beside it: its own hashes must name this snapshot exactly.
    if (run.evidence?.agentId !== input.agentId || run.evidence.configHash !== snapshot.configHash
        || run.evidence.dependencyRevision !== snapshot.manifest.revision) return false;
    const live = sealRevision(snapshot.manifest.tenantId,
        snapshot.manifest.dependencies.filter(item => !item.key.startsWith('frozen.')),
        snapshot.manifest.exclusions);
    if (live.revision !== input.current.revision) return false;
    revisions.add(snapshot.manifest.revision);
    return true;
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
 *
 * Within one required case the newest durably ordered attempt decides: a failure
 * followed by a retry that passed is recovered, and an old pass never hides a
 * newer failure.
 */
export function intentEvidence(intentKey: string, currentAgentVersion: number | null,
    runs: readonly SealedRunCandidate[],
    scope?: IntentEvidenceScope): IntentEvidence {
    const relevant = runs.filter(run => run.accepted !== false && evidenceIsValid(run.evidence)
        && run.evidence.scenarios.some((scenario: any) =>
            typeof scenario?.managedSeedKey === 'string' && scenario.managedSeedKey.startsWith(`intent_${intentKey}_`)));
    const older = relevant.some(run => currentAgentVersion === null || run.agentVersion !== currentAgentVersion);
    const scopeChannels = scope ? [...new Set(scope.channels.map(canonicalEvidenceChannel))] : [];
    // Version alone does not identify knowledge, tool policy, channel or scenario
    // definitions. A caller without the current snapshot cannot certify a task.
    if (!scope || !/^[a-f0-9]{64}$/.test(scope.configHash) || !/^[a-f0-9]{64}$/.test(scope.dependencyRevision)
        || !listCanonicalSubtypeExperienceProfileIds().includes(scope.profileId)
        || !scopeChannels.length || scopeChannels.some(channel => !(CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel))
        || !scope.languages.length || scope.languages.some(language => !(EVAL_LANGUAGES as readonly string[]).includes(language))
        || (scope.currentDependencyRevisions ?? []).some(revision => !/^[a-f0-9]{64}$/.test(revision))) {
        return older ? 'stale' : 'not_verified';
    }
    const [industry, subtype] = scope.profileId.split('/');
    if (!buildDomainContractDraft(industry, subtype).intents.some(intent => intent.key === intentKey)) return 'not_verified';
    const revisions = new Set<string>([scope.dependencyRevision, ...(scope.currentDependencyRevisions ?? [])]);
    const matchingAgent = relevant.filter(run => run.evidence.agentId === scope.agentId);
    // A run only certifies once an authority reader validated its own snapshot;
    // sharing a revision with a run that was validated is not the same thing.
    const current = matchingAgent.filter(run => currentAgentVersion !== null && run.agentVersion === currentAgentVersion
        && run.authorityVerified !== false
        && run.evidence.configHash === scope.configHash && revisions.has(run.evidence.dependencyRevision));
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
        for (const channel of scopeChannels) {
            for (const [key, definitions] of expected) {
                required++;
                const attempts = current
                    .filter(run => canonicalEvidenceChannel(run.evidence.channelType) === channel)
                    .flatMap(run => run.evidence.scenarios
                        .filter((scenario: any) => scenario.profileId === scope.profileId
                            && scenario.language === language && scenario.managedSeedKey === key
                            && definitions.has(releaseScenarioDefinition(scenario)))
                        .map((scenario: any) => ({ order: attemptOrder(run), passed: releaseScenarioPassed(scenario, run.evidence) })));
                if (!attempts.length) continue;
                // Only the newest durably ordered attempt speaks. Attempts that
                // share that order are all decisive, so an undated pair that
                // disagrees stays failed instead of picking the kinder one.
                const newest = attempts.reduce((latest, attempt) => attempt.order > latest ? attempt.order : latest, attempts[0].order);
                if (attempts.filter(attempt => attempt.order === newest).some(attempt => !attempt.passed)) return 'failed';
                proven++;
            }
        }
    }
    if (required > 0 && proven === required) return 'verified';
    if (!current.length && matchingAgent.some(run => run.agentVersion !== currentAgentVersion
        || run.authorityVerified === false
        || run.evidence.configHash !== scope.configHash || !revisions.has(run.evidence.dependencyRevision))) return 'stale';
    return 'not_verified';
}
