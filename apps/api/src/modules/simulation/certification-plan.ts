import { CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES,
    listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { requiredScenarios } from './agent-certification';
import { LLM_MODEL_CATALOGUE } from '../ai/router/llm-router.service';

/**
 * What certifying the catalogue would actually cost, computed before anybody
 * authorises spending it.
 *
 * `certifyProfiles` counts the cross product of profile × language × channel ×
 * model × scenario and answers `no_evidence` for all 76 profiles, because no run
 * has ever produced that evidence. Nothing in this repository could produce it:
 * there is no executor that walks the catalogue. Building one starts here,
 * because the first thing anyone will ask of it is "how many model calls is
 * that, how long, and what is the most it can cost" — and the answer has to be
 * exact where it can be and declared where it cannot.
 *
 * Exact, derived and not assumed:
 *   · the profiles, from the canonical catalogue;
 *   · the scenarios per profile and language, from the same `requiredScenarios`
 *     the certification report uses — a plan that planned a different universe
 *     from the one certification demands would be a plan for the wrong thing,
 *     so this asserts they match rather than trusting that they do;
 *   · the model CALLS, from the customer messages in each scenario. A scenario
 *     is a conversation, not a prompt: three messages is three turns.
 *
 * Declared, because it cannot be known before running:
 *   · the tokens a turn spends, so cost is reported as a CEILING computed from
 *     an explicit upper bound, never as an estimate that reads like a fact;
 *   · the seconds a turn takes.
 *
 * The rates come from the router's own catalogue, so the number here and the
 * number the runtime bills can never be two different price lists.
 */

/** Upper bounds, stated so the ceiling is auditable rather than magic. */
export interface CertificationTokenBound {
    /** Prompt tokens a single turn may spend. */
    readonly inputPerTurn: number;
    /** Completion tokens a single turn may spend. */
    readonly outputPerTurn: number;
}

export const DEFAULT_TOKEN_BOUND: CertificationTokenBound = Object.freeze({
    // A turn carries the three prompt layers, the business snapshot and up to
    // four messages of history; 8k in and 1k out is above what the production
    // logs show and below the smallest context window in the catalogue.
    inputPerTurn: 8_000,
    outputPerTurn: 1_000,
});

export const DEFAULT_SECONDS_PER_TURN = 6;

export interface CertificationPlanInput {
    /** Defaults to every canonical profile. */
    readonly profiles?: readonly string[];
    /** Defaults to the four languages the product declares. */
    readonly languages?: readonly string[];
    readonly channels: readonly string[];
    /** Model ids. Each must exist in the router's catalogue or the plan refuses it. */
    readonly models: readonly string[];
    /** Attempts per scenario, the `k` of pass^k. */
    readonly k?: number;
    readonly tokenBound?: CertificationTokenBound;
    readonly secondsPerTurn?: number;
}

export interface CertificationPlanCell {
    readonly profileId: string;
    readonly language: string;
    readonly channel: string;
    readonly model: string;
    readonly scenarios: number;
    readonly turns: number;
    readonly modelCalls: number;
    readonly maxCostUsdCents: number;
    readonly maxSeconds: number;
}

export interface CertificationPlan {
    readonly version: 1;
    readonly planHash: string;
    readonly profiles: readonly string[];
    readonly languages: readonly string[];
    readonly channels: readonly string[];
    readonly models: readonly string[];
    readonly k: number;
    readonly tokenBound: CertificationTokenBound;
    readonly secondsPerTurn: number;
    readonly cells: readonly CertificationPlanCell[];
    readonly totals: {
        readonly cells: number;
        /** Equal to the `requiredCases` the certification report demands. */
        readonly requiredCases: number;
        readonly modelCalls: number;
        readonly maxCostUsdCents: number;
        readonly maxSeconds: number;
    };
    /**
     * What the plan will NOT do and why. A plan that quietly dropped an unknown
     * model would under-report the spend it is asking permission for.
     */
    readonly refusals: readonly string[];
}

export function planCertificationRun(input: CertificationPlanInput): CertificationPlan {
    const refusals: string[] = [];

    const canonical = listCanonicalSubtypeExperienceProfileIds();
    const requestedProfiles = input.profiles?.length ? [...new Set(input.profiles)] : canonical;
    const profiles = requestedProfiles.filter(profile => canonical.includes(profile)).sort();
    for (const profile of requestedProfiles) {
        if (!canonical.includes(profile)) refusals.push(`profile_not_canonical:${profile}`);
    }

    const requestedLanguages = input.languages?.length ? [...new Set(input.languages)] : [...EVAL_LANGUAGES];
    const languages = requestedLanguages.filter(language => (EVAL_LANGUAGES as readonly string[]).includes(language)).sort();
    for (const language of requestedLanguages) {
        if (!(EVAL_LANGUAGES as readonly string[]).includes(language)) refusals.push(`language_out_of_contract:${language}`);
    }
    // Certification demands all four; a plan that covers three cannot certify
    // anything, and saying so here is cheaper than discovering it after a run.
    for (const language of EVAL_LANGUAGES) {
        if (!languages.includes(language)) refusals.push(`language_missing_from_plan:${language}`);
    }

    const requestedChannels = [...new Set(input.channels)];
    const channels = requestedChannels.filter(channel => (CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel)).sort();
    for (const channel of requestedChannels) {
        if (!(CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel)) refusals.push(`channel_not_conversational:${channel}`);
    }
    if (!channels.length) refusals.push('channel_scope_required');

    const rates = new Map(LLM_MODEL_CATALOGUE.map(model => [model.id, model]));
    const requestedModels = [...new Set(input.models)];
    const models = requestedModels.filter(model => rates.has(model)).sort();
    for (const model of requestedModels) {
        if (!rates.has(model)) refusals.push(`model_not_in_catalogue:${model}`);
    }
    if (!models.length) refusals.push('model_scope_required');

    const k = Math.max(1, Math.min(Math.trunc(input.k ?? 1) || 1, 5));
    const tokenBound = input.tokenBound ?? DEFAULT_TOKEN_BOUND;
    const secondsPerTurn = Math.max(1, input.secondsPerTurn ?? DEFAULT_SECONDS_PER_TURN);

    const cells: CertificationPlanCell[] = [];
    let requiredCases = 0, modelCalls = 0, maxCostUsdCents = 0, maxSeconds = 0;

    for (const profileId of profiles) {
        for (const language of languages) {
            // The universe certification will demand, from the function that
            // demands it. Not a second walk of the packs: two definitions of
            // what a profile owes would drift the first time a pack changed,
            // and the plan would be a plan for a different run than the report.
            const demanded = requiredScenarios(profileId, language);
            const scenarios = demanded.size;
            const turns = [...demanded.values()].reduce((sum, entry) => sum + entry.turns, 0);
            for (const channel of channels) {
                for (const model of models) {
                    const rate = rates.get(model)!;
                    const calls = turns * k;
                    // Ceiling, from the declared bound and the catalogue's own
                    // rates. Rounded UP: a budget that rounds down is a budget
                    // that gets exceeded.
                    const cost = Math.ceil(calls
                        * ((tokenBound.inputPerTurn / 1000) * rate.costInPer1k
                            + (tokenBound.outputPerTurn / 1000) * rate.costOutPer1k)
                        * 100);
                    const seconds = calls * secondsPerTurn;
                    cells.push(Object.freeze({
                        profileId, language, channel, model,
                        scenarios, turns, modelCalls: calls,
                        maxCostUsdCents: cost, maxSeconds: seconds,
                    }));
                    requiredCases += scenarios;
                    modelCalls += calls;
                    maxCostUsdCents += cost;
                    maxSeconds += seconds;
                }
            }
        }
    }

    const body = {
        version: 1 as const,
        profiles, languages, channels, models, k, tokenBound, secondsPerTurn,
        totals: { cells: cells.length, requiredCases, modelCalls, maxCostUsdCents, maxSeconds },
    };
    return Object.freeze({
        ...body,
        planHash: revisionHash(body),
        cells: Object.freeze(cells),
        refusals: Object.freeze([...new Set(refusals)].sort()),
    });
}
