export const MEDIA_AI_CONSENT_VERSION = 1 as const;
export const MAX_EPHEMERAL_MEDIA_RETENTION_MS = 60 * 60_000;
export const MAX_BOUNDED_MEDIA_RETENTION_MS = 30 * 24 * 60 * 60_000;

export type MediaAiOperation = 'image_analysis' | 'audio_transcription' | 'voice_generation';

export interface MediaAiConsentAttestation {
    version: typeof MEDIA_AI_CONSENT_VERSION;
    proofId: string;
    subjectId: string;
    source: 'verified_consent_registry';
    purposes: readonly MediaAiOperation[];
    grantedAt: string;
    expiresAt: string;
    revokedAt?: string;
}

export interface MediaRetentionAttestation {
    scope: 'source_and_derived';
    mode: 'ephemeral' | 'bounded';
    deleteAt: string;
    enforcement: 'in_memory_only' | 'verified_cleanup';
}

export interface MediaAiGovernanceInput {
    operation: MediaAiOperation;
    subjectId: string;
    consent?: MediaAiConsentAttestation | null;
    retention?: MediaRetentionAttestation | null;
    /** Must come from infrastructure, never from the request attestation. */
    boundedDeletionVerified: boolean;
    now?: Date;
}

export interface MediaAiGovernanceDecision {
    allowed: boolean;
    allowDurablePersistence: boolean;
    reasons: readonly string[];
}

function time(value: unknown): number | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** Fail-closed consent + source/derived retention gate for every multimodal operation. */
export function evaluateMediaAiGovernance(
    input: MediaAiGovernanceInput,
): MediaAiGovernanceDecision {
    const now = (input.now || new Date()).getTime();
    const reasons: string[] = [];
    const consent = input.consent;
    const retention = input.retention;

    if (!consent) {
        reasons.push('consent_missing');
    } else {
        const grantedAt = time(consent.grantedAt);
        const expiresAt = time(consent.expiresAt);
        const revokedAt = consent.revokedAt === undefined ? undefined : time(consent.revokedAt);
        if (consent.version !== MEDIA_AI_CONSENT_VERSION
            || consent.source !== 'verified_consent_registry'
            || !consent.proofId?.trim()) reasons.push('consent_proof_invalid');
        if (!input.subjectId?.trim() || consent.subjectId !== input.subjectId) reasons.push('consent_subject_mismatch');
        if (!Array.isArray(consent.purposes) || !consent.purposes.includes(input.operation)) {
            reasons.push('consent_purpose_missing');
        }
        if (grantedAt === null || grantedAt > now) reasons.push('consent_grant_time_invalid');
        if (expiresAt === null || expiresAt <= now) reasons.push('consent_expired');
        if (revokedAt !== undefined && (revokedAt === null || revokedAt <= now)) reasons.push('consent_revoked');
    }

    let allowDurablePersistence = false;
    if (!retention) {
        reasons.push('retention_policy_missing');
    } else {
        const deleteAt = time(retention.deleteAt);
        if (retention.scope !== 'source_and_derived' || deleteAt === null || deleteAt <= now) {
            reasons.push('retention_policy_invalid');
        } else if (retention.mode === 'ephemeral') {
            if (retention.enforcement !== 'in_memory_only'
                || deleteAt > now + MAX_EPHEMERAL_MEDIA_RETENTION_MS) {
                reasons.push('ephemeral_retention_unbounded');
            }
        } else if (retention.mode === 'bounded') {
            if (retention.enforcement !== 'verified_cleanup'
                || deleteAt > now + MAX_BOUNDED_MEDIA_RETENTION_MS
                || input.boundedDeletionVerified !== true) {
                reasons.push('bounded_retention_not_enforced');
            } else {
                allowDurablePersistence = true;
            }
        } else {
            reasons.push('retention_mode_invalid');
        }
    }

    return Object.freeze({
        allowed: reasons.length === 0,
        allowDurablePersistence: reasons.length === 0 && allowDurablePersistence,
        reasons: Object.freeze(reasons),
    });
}
