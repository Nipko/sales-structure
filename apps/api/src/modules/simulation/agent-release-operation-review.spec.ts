import { releaseOperationReview } from './agent-release-operation-review';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { releaseRunContext, sealReleaseRun } from './agent-release-policy';
import { evaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { randomUUID } from 'crypto';

describe('public operational checks used for human release review', () => {
    const fixture = () => {
        const snapshot = evaluationSnapshot(randomUUID(), randomUUID(), { version: 7, config_json: {} });
        snapshot.manifest = { revision: 'a'.repeat(64) } as any;
        const scenario = { key: 'book', language: 'es', expectedActions: [{ kind: 'db_effect', type: 'row_exists', family: 'appointments',
            where: { email: 'PRIVATE' }, description: 'PRIVATE' }, { kind: 'tool_call', type: 'called', tool: 'create_appointment' }] };
        const evidence = { agentId: snapshot.agentId, dependencyRevision: snapshot.manifest!.revision, configHash: snapshot.configHash,
            channelType: 'web_widget', status: 'completed', k: 3, passPolicy: 'all', threshold: 8, scenarios: [scenario] };
        const result = { key: scenario.key, scenarioHash: revisionHash(scenario), contextHash: releaseRunContext(evidence),
            runs: [{ actionChecks: [{ ok: true, detail: 'PRIVATE' }, { ok: false }] }, { actionChecks: [{ ok: false }, { ok: true }] }, {}] };
        return { snapshot, evidence, result, run: sealReleaseRun({ ...evidence, results: [result] }) };
    };
    it('keeps failed, missing and successful checks separate without exposing SQL filters or free diagnostic text', () => {
        const { snapshot, run } = fixture();
        const rows = releaseOperationReview(snapshot, [run]);
        expect(rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ family: 'appointments', assertion: 'row_exists', passed: 1, failed: 1, unknown: 1, required: 3, status: 'failed' }),
            expect.objectContaining({ tool: 'create_appointment', assertion: 'called', passed: 1, failed: 1, unknown: 1 }),
        ]));
        expect(JSON.stringify(rows)).not.toContain('PRIVATE'); expect(JSON.stringify(rows)).not.toContain('where');
    });
    it.each(['hash', 'scenario', 'context', 'channel_revision'])('marks results unknown when their %s is not bound to the reviewed snapshot', reason => {
        const { snapshot, evidence, result } = fixture();
        if (reason === 'scenario') result.scenarioHash = 'b'.repeat(64);
        if (reason === 'context') result.contextHash = 'b'.repeat(64);
        if (reason === 'channel_revision') evidence.dependencyRevision = 'b'.repeat(64);
        const run = sealReleaseRun({ ...evidence, results: [result] });
        if (reason === 'hash') run.evidenceHash = 'b'.repeat(64);
        expect(releaseOperationReview(snapshot, [run]).every(row => row.passed === 0 && row.failed === 0 && row.unknown === 3 && row.status === 'unknown')).toBe(true);
    });
    it('requires matching assertions in every attempt before reporting the operation check verified', () => {
        const { snapshot, evidence, result } = fixture();
        result.runs = Array.from({ length: 3 }, () => ({ actionChecks: [{ ok: true }, { ok: true }] }));
        expect(releaseOperationReview(snapshot, [sealReleaseRun({ ...evidence, results: [result] })]).every(row => row.status === 'verified' && row.passed === 3)).toBe(true);
        result.runs[0].actionChecks!.pop();
        expect(releaseOperationReview(snapshot, [sealReleaseRun({ ...evidence, results: [result] })]).every(row => row.status === 'unknown' && row.unknown === 1)).toBe(true);
    });
});
