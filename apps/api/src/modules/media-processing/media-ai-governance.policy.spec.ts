import {
    evaluateMediaAiGovernance,
    type MediaAiConsentAttestation,
    type MediaRetentionAttestation,
} from './media-ai-governance.policy';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const CONSENT: MediaAiConsentAttestation = {
    version: 1,
    proofId: 'consent-1',
    subjectId: 'contact-1',
    source: 'verified_consent_registry',
    purposes: ['image_analysis', 'audio_transcription'],
    grantedAt: '2026-08-08T11:00:00.000Z',
    expiresAt: '2026-08-09T12:00:00.000Z',
};
const EPHEMERAL: MediaRetentionAttestation = {
    scope: 'source_and_derived',
    mode: 'ephemeral',
    deleteAt: '2026-08-08T12:30:00.000Z',
    enforcement: 'in_memory_only',
};

describe('media/voice AI governance gate', () => {
    it('allows consented ephemeral analysis without durable persistence', () => {
        expect(evaluateMediaAiGovernance({
            operation: 'image_analysis', subjectId: 'contact-1',
            consent: CONSENT, retention: EPHEMERAL, boundedDeletionVerified: false, now: NOW,
        })).toEqual({ allowed: true, allowDurablePersistence: false, reasons: [] });
    });

    it('requires operation-specific voice consent at the same risk gate', () => {
        const decision = evaluateMediaAiGovernance({
            operation: 'voice_generation', subjectId: 'contact-1',
            consent: CONSENT, retention: EPHEMERAL, boundedDeletionVerified: false, now: NOW,
        });
        expect(decision.allowed).toBe(false);
        expect(decision.reasons).toContain('consent_purpose_missing');
    });

    it('rejects missing/revoked consent and durable retention without verified cleanup', () => {
        const noConsent = evaluateMediaAiGovernance({
            operation: 'audio_transcription', subjectId: 'contact-1',
            retention: EPHEMERAL, boundedDeletionVerified: false, now: NOW,
        });
        expect(noConsent.reasons).toContain('consent_missing');

        const bounded = evaluateMediaAiGovernance({
            operation: 'audio_transcription', subjectId: 'contact-1', consent: CONSENT,
            boundedDeletionVerified: false, now: NOW,
            retention: {
                scope: 'source_and_derived', mode: 'bounded',
                deleteAt: '2026-08-10T12:00:00.000Z', enforcement: 'verified_cleanup',
            },
        });
        expect(bounded.allowed).toBe(false);
        expect(bounded.reasons).toContain('bounded_retention_not_enforced');
    });
});
