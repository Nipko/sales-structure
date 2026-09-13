import { buildDomainContractDraft, composeSubtypeEvalPack, CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES,
    listCanonicalSubtypeExperienceProfileIds, type AddressForm } from '@parallext/shared';
import { evidenceIsValid, releaseScenarioDefinition, releaseScenarioPassed,
    type AgentReleaseRunEvidence } from './agent-release-policy';

/**
 * Whether a profile has been shown to do its work, computed from evidence.
 *
 * Two matrices reported `certifiedProfiles: 0` as a literal and a per-profile
 * `certification: { certified: false, evidence: 'not_loaded' }`, which is not a
 * measurement — it is a placeholder that would keep saying zero after the runs
 * existed. The number here is derived: it counts profiles whose every required
 * case has passing, hash-valid evidence naming that profile.
 *
 * The universe of required cases is deliberately the full cross product of
 * profile, language, channel, model and scenario. A profile is not certified by
 * a sibling profile, a language is not certified by another language, and a
 * model is not certified by another model — the runtime can serve a customer
 * with any of them, so evidence for one says nothing about the rest. That is
 * also why `no_evidence` is its own state: "we never looked" and "we looked and
 * it failed" are different answers and a single boolean flattens them.
 */

export const CERTIFICATION_STATES = ['certified', 'not_certified', 'no_evidence'] as const;
export type CertificationState = (typeof CERTIFICATION_STATES)[number];

export interface CertificationScope {
    /** Channels this profile is meant to operate on. Empty means nothing is required. */
    readonly channels: readonly string[];
    /** Customer languages the runtime may switch to. One cannot certify another. */
    readonly languages?: readonly string[];
    /**
     * Every model that may serve this profile. Certification is per model
     * because a change of model changes the agent; a run that did not record
     * which model produced it proves nothing about any of them.
     */
    readonly models: readonly string[];
    /** When set, only these task keys are required — a deliberately narrower mission. */
    readonly intentKeys?: readonly string[];
}

export interface CertificationCoverage {
    readonly required: number;
    readonly verified: number;
}

export interface ProfileCertification {
    readonly profileId: string;
    readonly state: CertificationState;
    readonly requiredCases: number;
    readonly verifiedCases: number;
    readonly byLanguage: Readonly<Record<string, CertificationCoverage>>;
    readonly byChannel: Readonly<Record<string, CertificationCoverage>>;
    readonly byModel: Readonly<Record<string, CertificationCoverage>>;
    /** Why it is not certified, bounded so a report stays readable. */
    readonly unproven: readonly { channel: string; language: string; model: string; scenario: string }[];
    readonly unprovenTotal: number;
    readonly reasons: readonly string[];
}

export interface CertificationReport {
    readonly version: 1;
    readonly evidenceKind: 'executed_runs';
    readonly profiles: readonly ProfileCertification[];
    readonly summary: {
        readonly profiles: number;
        readonly certified: number;
        readonly notCertified: number;
        readonly withoutEvidence: number;
        readonly requiredCases: number;
        readonly verifiedCases: number;
    };
}

const UNPROVEN_SAMPLE = 20;

/** The model a run served, taken from the evidence rather than assumed. */
export function evidenceModels(row: AgentReleaseRunEvidence): readonly string[] {
    const declared = (row as any).models;
    if (Array.isArray(declared)) {
        return [...new Set(declared.filter((value: unknown) => typeof value === 'string' && value.trim())
            .map((value: string) => value.trim()))].sort();
    }
    const observed = new Set<string>();
    for (const result of Array.isArray(row.results) ? row.results : []) {
        for (const attempt of Array.isArray(result?.runs) ? result.runs : []) {
            if (typeof attempt?.model === 'string' && attempt.model.trim()) observed.add(attempt.model.trim());
        }
    }
    return [...observed].sort();
}

/** One required case: the definitions that count as it, and what it costs to run. */
export interface RequiredScenario {
    /** Every rendering of this case; evidence must match one of them exactly. */
    readonly definitions: Set<string>;
    /**
     * Customer messages in the longest rendering, which is how many turns — and
     * therefore how many model calls — running this case once takes.
     */
    readonly turns: number;
}

/**
 * The scenario keys a profile owes in one language, collapsed across the
 * address forms Spanish renders the same case in.
 *
 * Composing a pack is expensive and the plan needs the same universe this does,
 * so both read THIS. A second walk of the packs would be a second definition of
 * what a profile owes, and the two would drift the first time a pack changed.
 */
export function requiredScenarios(profileId: string, language: string,
    intentKeys?: readonly string[]): Map<string, RequiredScenario> {
    const [industry, subtype] = profileId.split('/');
    const domain = buildDomainContractDraft(industry, subtype);
    const variants = new Map<string, { definitions: Set<string>; turns: number }>();
    const forms = (language === 'es' ? [null, 'tu', 'usted', 'vos'] : [null]) as Array<AddressForm | null>;
    for (const addressForm of forms) {
        for (const scenario of composeSubtypeEvalPack({ industry, subtype, language, addressForm })) {
            if (intentKeys) {
                const task = domain.intents.find(intent => scenario.key.startsWith(`intent_${intent.key}_`));
                if (task && !intentKeys.includes(task.key)) continue;
            }
            const entry = variants.get(scenario.key) || { definitions: new Set<string>(), turns: 0 };
            entry.definitions.add(releaseScenarioDefinition(scenario));
            entry.turns = Math.max(entry.turns, Array.isArray(scenario.messages) ? scenario.messages.length : 0);
            variants.set(scenario.key, entry);
        }
    }
    return variants;
}

/**
 * Compute one profile's state from the runs that exist.
 *
 * Only evidence that names this exact profile counts, and only a scenario whose
 * stored definition still matches the one the pack produces today — a case that
 * has since been rewritten was never proven in its current form.
 */
export function certifyProfile(input: {
    profileId: string;
    scope: CertificationScope;
    evidence: readonly AgentReleaseRunEvidence[];
}): ProfileCertification {
    const reasons: string[] = [];
    if (!listCanonicalSubtypeExperienceProfileIds().includes(input.profileId)) {
        return Object.freeze({
            profileId: input.profileId, state: 'no_evidence' as const, requiredCases: 0, verifiedCases: 0,
            byLanguage: Object.freeze({}), byChannel: Object.freeze({}), byModel: Object.freeze({}),
            unproven: Object.freeze([]), unprovenTotal: 0,
            reasons: Object.freeze(['canonical_profile_required']),
        });
    }
    const languages = [...new Set(input.scope.languages?.length ? input.scope.languages : EVAL_LANGUAGES)];
    if (EVAL_LANGUAGES.some(language => !languages.includes(language))) reasons.push('language_scope_incomplete');
    const channels = [...new Set(input.scope.channels)]
        .filter(channel => (CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel));
    if (!channels.length) reasons.push('operational_channel_scope_required');
    const models = [...new Set(input.scope.models.filter(model => typeof model === 'string' && model.trim()))];
    if (!models.length) reasons.push('model_scope_required');

    const valid = input.evidence.filter(evidenceIsValid);
    if (valid.length !== input.evidence.length) reasons.push('run_evidence_invalid');

    const byLanguage: Record<string, { required: number; verified: number }> = {};
    const byChannel: Record<string, { required: number; verified: number }> = {};
    const byModel: Record<string, { required: number; verified: number }> = {};
    const unproven: { channel: string; language: string; model: string; scenario: string }[] = [];
    let requiredCases = 0, verifiedCases = 0, unprovenTotal = 0;

    for (const language of languages) {
        const variants = requiredScenarios(input.profileId, language, input.scope.intentKeys);
        for (const channel of channels) {
            for (const model of models) {
                const servingModel = valid.filter(row => row.channelType === channel
                    && evidenceModels(row).includes(model));
                for (const [key, required] of variants) {
                    requiredCases++;
                    byLanguage[language] ??= { required: 0, verified: 0 };
                    byChannel[channel] ??= { required: 0, verified: 0 };
                    byModel[model] ??= { required: 0, verified: 0 };
                    byLanguage[language].required++;
                    byChannel[channel].required++;
                    byModel[model].required++;
                    const proven = servingModel.some(row => row.scenarios.some((scenario: any) =>
                        scenario.profileId === input.profileId && scenario.language === language
                        && scenario.managedSeedKey === key
                        && required.definitions.has(releaseScenarioDefinition(scenario))
                        && releaseScenarioPassed(scenario, row)));
                    if (proven) {
                        verifiedCases++;
                        byLanguage[language].verified++;
                        byChannel[channel].verified++;
                        byModel[model].verified++;
                    } else {
                        unprovenTotal++;
                        if (unproven.length < UNPROVEN_SAMPLE) unproven.push({ channel, language, model, scenario: key });
                    }
                }
            }
        }
    }

    // Three states, not a boolean: never executed is a different answer from
    // executed and failed, and only one of them is a defect of the agent.
    const state: CertificationState = requiredCases > 0 && verifiedCases === requiredCases && !reasons.length
        ? 'certified'
        : verifiedCases === 0 ? 'no_evidence' : 'not_certified';
    if (state !== 'certified' && !reasons.length) reasons.push('required_scenario_unproven');

    return Object.freeze({
        profileId: input.profileId, state, requiredCases, verifiedCases,
        byLanguage: Object.freeze(byLanguage), byChannel: Object.freeze(byChannel), byModel: Object.freeze(byModel),
        unproven: Object.freeze(unproven), unprovenTotal,
        reasons: Object.freeze([...new Set(reasons)].sort()),
    });
}

/**
 * The whole catalogue, one state per profile.
 *
 * With no runs stored this answers `no_evidence` for all 76, which is the
 * honest reading of an agent nobody has exercised — and it will answer
 * differently the moment runs exist, which a hard-coded zero never would.
 */
export function certifyProfiles(input: {
    scope: CertificationScope;
    evidence: readonly AgentReleaseRunEvidence[];
    profiles?: readonly string[];
}): CertificationReport {
    const ids = [...(input.profiles?.length ? input.profiles : listCanonicalSubtypeExperienceProfileIds())].sort();
    const profiles = ids.map(profileId => certifyProfile({ profileId, scope: input.scope, evidence: input.evidence }));
    return Object.freeze({
        version: 1 as const,
        evidenceKind: 'executed_runs' as const,
        profiles: Object.freeze(profiles),
        summary: Object.freeze({
            profiles: profiles.length,
            certified: profiles.filter(profile => profile.state === 'certified').length,
            notCertified: profiles.filter(profile => profile.state === 'not_certified').length,
            withoutEvidence: profiles.filter(profile => profile.state === 'no_evidence').length,
            requiredCases: profiles.reduce((total, profile) => total + profile.requiredCases, 0),
            verifiedCases: profiles.reduce((total, profile) => total + profile.verifiedCases, 0),
        }),
    });
}
