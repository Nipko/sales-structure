import { composeSubtypeEvalPack, EVAL_LANGUAGES, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { certifyProfile, certifyProfiles, evidenceModels } from './agent-certification';
import { releaseScenarioDefinition, sealReleaseRun, releaseRunContext,
    type AgentReleaseRunEvidence } from './agent-release-policy';
import { revisionHash } from '../evaluation-revision/evaluation-revision';

/**
 * What "certified" is allowed to mean.
 *
 * Two matrices reported `certifiedProfiles: 0` as a literal, which is not a
 * measurement — it would keep saying zero after the runs existed and it could
 * never say anything else. These tests are mostly about the opposite risk: that
 * a computed number starts saying yes for the wrong reason. A sibling profile,
 * another language, another channel, another model, an edited scenario or a run
 * whose seal does not verify must all fail to certify anything.
 */
describe('computing whether a profile has been shown to do its work', () => {
    const profileId = 'salud/dental';
    const otherProfile = listCanonicalSubtypeExperienceProfileIds().find(id => id !== profileId)!;
    const scope = { channels: ['web_widget'], models: ['gpt-4o-mini'] };

    /** A run that proves every case of one language on one channel and model. */
    function passingRun(over: {
        profileId?: string; language?: string; channel?: string; models?: string[];
        languages?: readonly string[];
    } = {}): AgentReleaseRunEvidence {
        const language = over.language ?? 'es';
        const targetProfile = over.profileId ?? profileId;
        const [industry, subtype] = targetProfile.split('/');
        const seeds = composeSubtypeEvalPack({ industry, subtype, language });
        const scenarios = seeds.map(seed => ({
            key: seed.key, managedSeedKey: seed.key, profileId: targetProfile, language,
            messages: seed.messages, criteria: seed.criteria, expectedActions: seed.expectedActions,
        }));
        const body = {
            agentId: 'agent-1', dependencyRevision: 'a'.repeat(64), configHash: 'b'.repeat(64),
            channelType: over.channel ?? 'web_widget', status: 'completed', k: 1,
            passPolicy: 'all', threshold: 8, models: over.models ?? ['gpt-4o-mini'],
        };
        const contextHash = releaseRunContext(body as any);
        const results = scenarios.map(scenario => ({
            key: scenario.key, contextHash, scenarioHash: revisionHash(scenario),
            passed: true, k: 1, passes: 1,
            runs: [{
                passed: true, flags: [], score: 9, models: over.models ?? ['gpt-4o-mini'],
                actionChecks: (scenario.expectedActions || []).map(() => ({ ok: true })),
            }],
        }));
        return sealReleaseRun({ ...body, scenarios, results } as any);
    }

    /** Every language a profile owes, so a full certification is reachable. */
    const everyLanguage = (over: Parameters<typeof passingRun>[0] = {}) =>
        EVAL_LANGUAGES.map(language => passingRun({ ...over, language }));

    it('answers no_evidence for every profile when nothing has been executed', () => {
        const report = certifyProfiles({ scope, evidence: [] });
        expect(report.summary.profiles).toBe(76);
        expect(report.summary.certified).toBe(0);
        expect(report.summary.notCertified).toBe(0);
        expect(report.summary.withoutEvidence).toBe(76);
        // Not "failed": nobody looked. Flattening the two is what a boolean does.
        expect(report.profiles.every(profile => profile.state === 'no_evidence')).toBe(true);
        expect(report.summary.requiredCases).toBeGreaterThan(0);
        expect(report.summary.verifiedCases).toBe(0);
    });

    it('certifies a profile whose every case is proven on its channel, model and languages', () => {
        const certification = certifyProfile({ profileId, scope, evidence: everyLanguage() });
        expect(certification.state).toBe('certified');
        expect(certification.verifiedCases).toBe(certification.requiredCases);
        expect(certification.requiredCases).toBeGreaterThan(0);
        expect(certification.unproven).toEqual([]);
        expect(certification.reasons).toEqual([]);
    });

    it('never lets one profile certify another', () => {
        const certification = certifyProfile({ profileId, scope, evidence: everyLanguage({ profileId: otherProfile }) });
        expect(certification.state).toBe('no_evidence');
        expect(certification.verifiedCases).toBe(0);
    });

    it('never lets one language certify the rest', () => {
        const certification = certifyProfile({ profileId, scope, evidence: [passingRun({ language: 'es' })] });
        expect(certification.state).toBe('not_certified');
        expect(certification.byLanguage.es.verified).toBe(certification.byLanguage.es.required);
        for (const language of EVAL_LANGUAGES.filter(entry => entry !== 'es')) {
            expect(certification.byLanguage[language].verified).toBe(0);
        }
    });

    it('never lets one channel certify another', () => {
        const certification = certifyProfile({
            profileId, scope: { channels: ['web_widget', 'whatsapp'], models: ['gpt-4o-mini'] },
            evidence: everyLanguage({ channel: 'web_widget' }),
        });
        expect(certification.state).toBe('not_certified');
        expect(certification.byChannel.web_widget.verified).toBe(certification.byChannel.web_widget.required);
        expect(certification.byChannel.whatsapp.verified).toBe(0);
    });

    it('never lets one model certify another', () => {
        const certification = certifyProfile({
            profileId, scope: { channels: ['web_widget'], models: ['gpt-4o-mini', 'claude-sonnet-5'] },
            evidence: everyLanguage({ models: ['gpt-4o-mini'] }),
        });
        expect(certification.state).toBe('not_certified');
        expect(certification.byModel['gpt-4o-mini'].verified).toBeGreaterThan(0);
        expect(certification.byModel['claude-sonnet-5'].verified).toBe(0);
    });

    it('refuses evidence that cannot say which model answered', () => {
        const anonymous = everyLanguage().map(row => sealReleaseRun({
            ...row,
            models: undefined,
            results: row.results.map((result: any) => ({
                ...result, runs: result.runs.map(({ models, ...attempt }: any) => attempt),
            })),
        } as any));
        expect(evidenceModels(anonymous[0])).toEqual([]);
        expect(certifyProfile({ profileId, scope, evidence: anonymous }).state).toBe('no_evidence');
    });

    it('refuses a run whose seal does not verify', () => {
        const tampered = everyLanguage().map(row => ({ ...row, threshold: 7 }));
        const certification = certifyProfile({ profileId, scope, evidence: tampered as any });
        expect(certification.state).toBe('no_evidence');
        expect(certification.reasons).toContain('run_evidence_invalid');
    });

    it('stops counting a case whose definition was rewritten after it passed', () => {
        const drifted = everyLanguage().map(row => sealReleaseRun({
            ...row,
            scenarios: row.scenarios.map((scenario: any, index: number) => index === 0
                ? { ...scenario, messages: [...scenario.messages, 'una pregunta que el caso no tenía'] }
                : scenario),
        } as any));
        const certification = certifyProfile({ profileId, scope, evidence: drifted });
        expect(certification.state).toBe('not_certified');
        expect(certification.unprovenTotal).toBeGreaterThan(0);
        // The rewritten one is the only case that stopped counting.
        expect(certification.requiredCases - certification.verifiedCases).toBe(certification.unprovenTotal);
    });

    it('refuses to call a profile certified while a language is missing from its scope', () => {
        const certification = certifyProfile({
            profileId, scope: { ...scope, languages: ['es'] }, evidence: everyLanguage(),
        });
        expect(certification.state).toBe('not_certified');
        expect(certification.reasons).toContain('language_scope_incomplete');
    });

    it('refuses a scope with no channel and one with no model', () => {
        expect(certifyProfile({ profileId, scope: { channels: [], models: ['gpt-4o-mini'] }, evidence: [] }).reasons)
            .toContain('operational_channel_scope_required');
        expect(certifyProfile({ profileId, scope: { channels: ['web_widget'], models: [] }, evidence: [] }).reasons)
            .toContain('model_scope_required');
    });

    it('refuses a profile that is not in the canonical catalogue', () => {
        expect(certifyProfile({ profileId: 'inventada/nada', scope, evidence: [] }).reasons)
            .toEqual(['canonical_profile_required']);
    });

    it('keeps the sample of unproven cases bounded but reports the real total', () => {
        const certification = certifyProfile({ profileId, scope, evidence: [] });
        expect(certification.unproven.length).toBeLessThanOrEqual(20);
        expect(certification.unprovenTotal).toBe(certification.requiredCases);
        expect(certification.unprovenTotal).toBeGreaterThan(certification.unproven.length);
    });

    it('collapses the Spanish address forms into one case instead of four', () => {
        const [industry, subtype] = profileId.split('/');
        const keys = new Set(['tu', 'usted', 'vos', null].flatMap(addressForm =>
            composeSubtypeEvalPack({ industry, subtype, language: 'es', addressForm: addressForm as any })
                .map(scenario => scenario.key)));
        const certification = certifyProfile({ profileId, scope, evidence: [] });
        expect(certification.byLanguage.es.required).toBe(keys.size);
    });

    it('shares one definition of a passing run with the release gate', () => {
        // Two copies of "this run counts" would drift, and the drift would look
        // like a pass on one side and a refusal on the other.
        const row = passingRun();
        expect(row.scenarios.every((scenario: any) =>
            releaseScenarioDefinition(scenario) === releaseScenarioDefinition(scenario))).toBe(true);
        expect(certifyProfile({ profileId, scope, evidence: everyLanguage() }).state).toBe('certified');
    });
});
