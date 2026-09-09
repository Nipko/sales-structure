import { CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { certifyProfiles } from './agent-certification';
import { DEFAULT_TOKEN_BOUND, planCertificationRun } from './certification-plan';

/**
 * The number somebody has to authorise before a single model call is made.
 *
 * A plan that under-counts is worse than no plan: it is a request for
 * permission to spend more than the permission covers. So the two halves that
 * can be exact are exact — the universe of cases comes from the same function
 * the certification report demands it from, and the call count comes from the
 * customer messages in the packs — and the half that cannot be is a declared
 * ceiling rather than an estimate wearing the clothes of a fact.
 */
describe('what certifying the catalogue would cost', () => {
    const channels = ['whatsapp', 'web_widget'];
    const models = ['gpt-4.1-mini'];

    it('plans exactly the universe the certification report demands', () => {
        const profiles = listCanonicalSubtypeExperienceProfileIds().slice(0, 3);
        const plan = planCertificationRun({ profiles, channels, models });
        // The report's own arithmetic, over the same scope and no evidence at
        // all. If these two ever disagree the plan is for a different run.
        const report = certifyProfiles({ profiles, evidence: [], scope: { channels, models, languages: [...EVAL_LANGUAGES] } });
        expect(plan.totals.requiredCases).toBe(report.summary.requiredCases);
        expect(report.summary.verifiedCases).toBe(0);
    });

    it('counts model calls from the conversation, not from the case', () => {
        const profiles = listCanonicalSubtypeExperienceProfileIds().slice(0, 1);
        const plan = planCertificationRun({ profiles, channels: ['whatsapp'], models });
        // A scenario is a conversation: every customer message is a turn and
        // every turn is at least one call. Counting cases would undercount.
        expect(plan.totals.modelCalls).toBeGreaterThan(plan.totals.requiredCases);
        for (const cell of plan.cells) expect(cell.modelCalls).toBe(cell.turns * plan.k);
    });

    it('multiplies by k, because pass^k means k attempts', () => {
        const profiles = listCanonicalSubtypeExperienceProfileIds().slice(0, 1);
        const once = planCertificationRun({ profiles, channels: ['whatsapp'], models });
        const thrice = planCertificationRun({ profiles, channels: ['whatsapp'], models, k: 3 });
        expect(thrice.totals.modelCalls).toBe(once.totals.modelCalls * 3);
        expect(thrice.totals.maxCostUsdCents).toBeGreaterThan(once.totals.maxCostUsdCents);
    });

    it('prices from the router catalogue and rounds the ceiling up', () => {
        const profiles = listCanonicalSubtypeExperienceProfileIds().slice(0, 1);
        const cheap = planCertificationRun({ profiles, channels: ['whatsapp'], models: ['gpt-4o-mini'] });
        const dear = planCertificationRun({ profiles, channels: ['whatsapp'], models: ['claude-sonnet-4-6'] });
        expect(dear.totals.maxCostUsdCents).toBeGreaterThan(cheap.totals.maxCostUsdCents);
        // The bound is declared, so the arithmetic can be checked by hand.
        const cell = cheap.cells[0];
        expect(cheap.tokenBound).toEqual(DEFAULT_TOKEN_BOUND);
        expect(cell.maxCostUsdCents).toBe(Math.ceil(cell.modelCalls
            * ((DEFAULT_TOKEN_BOUND.inputPerTurn / 1000) * 0.00015
                + (DEFAULT_TOKEN_BOUND.outputPerTurn / 1000) * 0.0006) * 100));
    });

    it('refuses what it will not run instead of quietly dropping it', () => {
        const plan = planCertificationRun({
            profiles: ['turismo/hotel', 'not/a-profile'],
            languages: ['es', 'de'],
            channels: ['whatsapp', 'email'],
            models: ['gpt-4.1-mini', 'a-model-nobody-has'],
        });
        expect(plan.refusals).toEqual(expect.arrayContaining([
            'profile_not_canonical:not/a-profile',
            'language_out_of_contract:de',
            'channel_not_conversational:email',
            'model_not_in_catalogue:a-model-nobody-has',
        ]));
        // And it says which of the four contracted languages it is not covering,
        // because a plan missing one cannot certify anything.
        expect(plan.refusals).toEqual(expect.arrayContaining([
            'language_missing_from_plan:en', 'language_missing_from_plan:fr', 'language_missing_from_plan:pt',
        ]));
        expect(plan.languages).toEqual(['es']);
        expect(plan.channels).toEqual(['whatsapp']);
        expect(plan.models).toEqual(['gpt-4.1-mini']);
    });

    it('says the scope is missing rather than planning nothing quietly', () => {
        const empty = planCertificationRun({ profiles: ['turismo/hotel'], channels: [], models: [] });
        expect(empty.refusals).toEqual(expect.arrayContaining(['channel_scope_required', 'model_scope_required']));
        expect(empty.totals.modelCalls).toBe(0);
        expect(empty.cells).toEqual([]);
    });

    it('is stable: the same scope plans the same hash', () => {
        const one = planCertificationRun({ profiles: ['turismo/hotel'], channels, models });
        const two = planCertificationRun({ profiles: ['turismo/hotel'], channels: [...channels].reverse(), models });
        expect(one.planHash).toBe(two.planHash);
        const other = planCertificationRun({ profiles: ['turismo/hotel'], channels, models, k: 2 });
        expect(other.planHash).not.toBe(one.planHash);
    });

    it('covers the whole catalogue when asked for nothing narrower', () => {
        const plan = planCertificationRun({ channels: [...CONVERSATIONAL_CHANNELS], models });
        expect(plan.profiles).toHaveLength(listCanonicalSubtypeExperienceProfileIds().length);
        expect(plan.languages).toEqual([...EVAL_LANGUAGES].sort());
        expect(plan.refusals).toEqual([]);
        expect(plan.totals.requiredCases).toBeGreaterThan(0);
        // eslint-disable-next-line no-console
        console.log(`[certification-plan] ${plan.profiles.length} profiles × ${plan.languages.length} languages `
            + `× ${plan.channels.length} channels × ${plan.models.length} model = `
            + `${plan.totals.requiredCases} cases, ${plan.totals.modelCalls} model calls, `
            + `ceiling US$${(plan.totals.maxCostUsdCents / 100).toFixed(2)}, `
            + `${Math.round(plan.totals.maxSeconds / 3600)}h of model time`);
    });
});
