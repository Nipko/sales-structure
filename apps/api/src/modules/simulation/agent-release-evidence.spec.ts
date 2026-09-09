import { intentEvidence, readSealedRunEvidence } from './agent-release-evidence';
import { releaseRunContext, sealReleaseRun, type AgentReleaseRunEvidence } from './agent-release-policy';
import { revisionHash } from '../evaluation-revision/evaluation-revision';

/**
 * Whether a specific task of the mission was ever proven.
 *
 * The assessment reported `evidence: 'not_verified'` as a literal, which is the
 * same shape as the certification count that could never say anything but zero:
 * it reads as caution and it is the opposite, because it would go on saying the
 * same thing after the runs existed.
 */
describe('what a stored run proves about one task', () => {
    const scenario = (key: string) => ({
        key, managedSeedKey: key, profileId: 'salud/dental', language: 'es',
        messages: ['Quiero una cita'], criteria: 'Reserva verificada', expectedActions: [],
    });

    function run(over: { keys: string[]; passed?: boolean }): AgentReleaseRunEvidence {
        const scenarios = over.keys.map(scenario);
        const body = {
            agentId: 'agent-1', dependencyRevision: 'a'.repeat(64), configHash: 'b'.repeat(64),
            channelType: 'web_widget', status: 'completed', k: 1, passPolicy: 'all', threshold: 8,
            models: ['gpt-4o-mini'],
        };
        const contextHash = releaseRunContext(body as any);
        return sealReleaseRun({
            ...body, scenarios,
            results: scenarios.map(entry => ({
                key: entry.key, contextHash, scenarioHash: revisionHash(entry),
                passed: over.passed !== false, k: 1, passes: over.passed === false ? 0 : 1,
                runs: [{ passed: over.passed !== false, flags: [], score: over.passed === false ? 4 : 9,
                    models: ['gpt-4o-mini'], actionChecks: [] }],
            })),
        } as any);
    }

    const at = (version: number, evidence: AgentReleaseRunEvidence) => ({ evidence, agentVersion: version });

    it('says not_verified when no run covers the task', () => {
        expect(intentEvidence('book_appointment', 2, [])).toBe('not_verified');
        expect(intentEvidence('book_appointment', 2, [at(2, run({ keys: ['intent_cancel_appointment_x'] }))]))
            .toBe('not_verified');
    });

    it('says verified when the current version passed every case of that task', () => {
        expect(intentEvidence('book_appointment', 2,
            [at(2, run({ keys: ['intent_book_appointment_canonical_complete_v1', 'intent_book_appointment_missing_slot'] }))]))
            .toBe('verified');
    });

    it('says failed when a case of that task did not pass under the current version', () => {
        expect(intentEvidence('book_appointment', 2,
            [at(2, run({ keys: ['intent_book_appointment_canonical_complete_v1'], passed: false }))]))
            .toBe('failed');
    });

    it('calls evidence from an older revision stale, never proof', () => {
        // The configuration that passed is not the configuration on screen, and
        // treating them as one is how a screen claims a task works because it
        // used to.
        expect(intentEvidence('book_appointment', 3,
            [at(2, run({ keys: ['intent_book_appointment_canonical_complete_v1'] }))]))
            .toBe('stale');
        expect(intentEvidence('book_appointment', null,
            [at(2, run({ keys: ['intent_book_appointment_canonical_complete_v1'] }))]))
            .toBe('stale');
    });

    it('lets a failure of the current version outrank a pass of an older one', () => {
        expect(intentEvidence('book_appointment', 3, [
            at(2, run({ keys: ['intent_book_appointment_canonical_complete_v1'] })),
            at(3, run({ keys: ['intent_book_appointment_canonical_complete_v1'], passed: false })),
        ])).toBe('failed');
    });

    it('reads nothing from a tenant with no eval table, rather than failing the assessment', async () => {
        const query = jest.fn(async (sql: string) =>
            sql.includes('to_regclass') ? [{ name: null }] : []) as any;
        await expect(readSealedRunEvidence(query, 'tenant_x', 'agent-1')).resolves.toEqual([]);
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('drops a stored run whose seal does not verify', async () => {
        const sealed = run({ keys: ['intent_book_appointment_canonical_complete_v1'] });
        const query = jest.fn(async (sql: string) =>
            sql.includes('to_regclass') ? [{ name: 'tenant_x.eval_runs' }]
                : [{ release_evidence: { ...sealed, threshold: 7 }, agent_snapshot: { version: 2 } },
                    { release_evidence: sealed, agent_snapshot: { version: 2 } }]) as any;
        const rows = await readSealedRunEvidence(query, 'tenant_x', 'agent-1');
        expect(rows).toHaveLength(1);
        expect(rows[0].agentVersion).toBe(2);
    });
});
