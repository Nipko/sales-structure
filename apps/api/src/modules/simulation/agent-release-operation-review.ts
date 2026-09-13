import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { releaseRunContext, type AgentReleaseRunEvidence } from './agent-release-policy';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';

const identifier = (value: unknown): string | null => typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value) ? value : null;
/** Counts assertions from intact persisted attempts. SQL filters, free descriptions and provider payloads stay private. */
export function releaseOperationReview(snapshot: AgentEvaluationSnapshot, runs: AgentReleaseRunEvidence[]) {
    return runs.flatMap(run => {
        const { evidenceHash, ...body } = run;
        const intact = revisionHash(body) === evidenceHash && run.agentId === snapshot.agentId && run.configHash === snapshot.configHash
            && run.dependencyRevision === snapshot.manifest?.revision && run.status === 'completed';
        const required = Number.isInteger(run.k) && run.k >= 1 && run.k <= 5 ? run.k : 0;
        return (Array.isArray(run.scenarios) ? run.scenarios : []).flatMap(scenario => {
            const matches = Array.isArray(run.results) ? run.results.filter(result => result.key === scenario.key) : [];
            const result = matches.length === 1 && matches[0].scenarioHash === revisionHash(scenario)
                && matches[0].contextHash === releaseRunContext(run) ? matches[0] : null;
            const actions = Array.isArray(scenario.expectedActions) ? scenario.expectedActions : [];
            return actions.map((action: any, index: number) => {
                let passed = 0, failed = 0, unknown = 0;
                for (let attempt = 0; attempt < required; attempt++) {
                    const checks = intact && Array.isArray(result?.runs) && result.runs.length === required ? result.runs[attempt]?.actionChecks : null;
                    const value = Array.isArray(checks) && checks.length === actions.length ? checks[index]?.ok : null;
                    if (value === true) passed++; else if (value === false) failed++; else unknown++;
                }
                return { channel: run.channelType, language: typeof scenario.language === 'string' ? scenario.language : null,
                    scenario: String(scenario.key), assertion: ['row_exists', 'row_count', 'no_row', 'called', 'not_called'].includes(action?.type) ? action.type : 'unknown',
                    family: identifier(action?.family), tool: identifier(action?.tool), required, passed, failed, unknown,
                    status: required > 0 && passed === required ? 'verified' : failed ? 'failed' : 'unknown' };
            });
        });
    });
}
