import { composeSubtypeEvalPack } from '@parallext/shared';
import { intentEvidence, readSealedRunEvidence, type IntentEvidenceScope } from './agent-release-evidence';
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
    const pack = composeSubtypeEvalPack({ industry: 'salud', subtype: 'dental', language: 'es' });
    const allCases = pack.filter(entry => entry.key.startsWith('intent_book_appointment_')).map(entry => entry.key);
    const scope: IntentEvidenceScope = { agentId: 'agent-1', dependencyRevision: 'a'.repeat(64), configHash: 'b'.repeat(64),
        profileId: 'salud/dental', channels: ['web_widget'], languages: ['es'] };
    const scenario = (key: string) => ({
        ...(pack.find(entry => entry.key === key) ?? { key, messages: ['Quiero una cita'], criteria: 'Reserva verificada', expectedActions: [] }),
        key, managedSeedKey: key, profileId: 'salud/dental', language: 'es',
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
                    models: ['gpt-4o-mini'], actionChecks: (entry.expectedActions ?? []).map(() => ({ ok: true })) }],
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
            [at(2, run({ keys: allCases }))], scope))
            .toBe('verified');
    });

    it('says failed when a case of that task did not pass under the current version', () => {
        expect(intentEvidence('book_appointment', 2,
            [at(2, run({ keys: ['intent_book_appointment_canonical_complete_v1'], passed: false }))], scope))
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
        ], scope)).toBe('failed');
    });

    it('does not certify a writer from a passing missing-slot case alone', () => {
        expect(intentEvidence('book_appointment', 2,
            [at(2, run({ keys: ['intent_book_appointment_missing_slot'] }))], scope)).toBe('not_verified');
    });

    it('does not certify a task when current dependency authority was not supplied', () => {
        expect(intentEvidence('book_appointment', 2, [at(2, run({ keys: allCases }))])).toBe('not_verified');
    });

    it.each(['configHash', 'dependencyRevision'] as const)('calls another %s stale even with the same version', field => {
        expect(intentEvidence('book_appointment', 2, [at(2, run({ keys: allCases }))],
            { ...scope, [field]: 'c'.repeat(64) })).toBe('stale');
    });

    it.each([
        { channels: ['whatsapp'] }, { channels: ['web_widget', 'whatsapp'] },
        { languages: ['es', 'en'] }, { profileId: 'salud/psicologia' }, { agentId: 'agent-2' },
    ])('does not transfer evidence to another scope: %j', override => {
        expect(intentEvidence('book_appointment', 2, [at(2, run({ keys: allCases }))],
            { ...scope, ...override })).not.toBe('verified');
    });

    it('does not accept renamed custom examples as canonical task evidence', () => {
        const evidence = run({ keys: allCases });
        const changed = evidence.scenarios.map(entry => ({ ...entry, messages: ['Una pregunta inventada'] }));
        const edited = sealReleaseRun({ ...evidence, scenarios: changed, results: evidence.results.map((result, index) => ({
            ...result, scenarioHash: revisionHash(changed[index]),
        })) });
        expect(intentEvidence('book_appointment', 2, [at(2, edited)], scope)).toBe('not_verified');
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
