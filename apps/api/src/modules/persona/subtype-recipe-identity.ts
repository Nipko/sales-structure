import { getSubtypeRecipeOverlay, getVerticalDefinition } from '../verticals/vertical-definitions';
import {
    normalizeVerticalPersonaLocale,
    resolveVerticalSubtypePersonaContract,
} from './vertical-subtype-persona-contract';

/**
 * Identity a subtype's own recipe gives the agent (name, role, voice, greeting).
 *
 * Precedence at birth, from the most specific to the most general:
 *   1. the subtype recipe (`SUBTYPE_RECIPE_OVERLAYS[...].agent`), when the
 *      subtype authored an agent of its own;
 *   2. the template the onboarding resolver picked for the industry and goals;
 *   3. the industry definition (`VerticalsService.patchDefaultAgent` only fills
 *      what is still empty after the two above).
 *
 * Why (1) beats (2): the goals the owner ticks choose HOW the agent behaves
 * (rules, tools, hand-off), and the industry template is written for the whole
 * industry. A dance academy's recipe names its agent, gives it a role and a
 * greeting that talks about dance; the education template greeted every
 * academy with "Soy Pablo, asesor académico" and the recipe's identity never
 * reached a single tenant, because the later patch only fills blanks and a
 * template is never blank.
 *
 * It lives at creation time on purpose: `createDefaultAgentFromGoals` is
 * create-only, so nothing the owner typed can be on the row yet. Applying it
 * in the idempotent bootstrap patch would overwrite a rename the next time a
 * provisioning rebuild runs.
 *
 * Subtypes without an agent overlay are returned untouched.
 */
export function applySubtypeRecipeIdentity(
    persona: Record<string, any> | undefined,
    industry: string | undefined,
    subType: string | undefined,
    language: string,
): { persona: Record<string, any> | undefined; applied: boolean } {
    if (!industry || !subType || !getSubtypeRecipeOverlay(industry, subType)?.agent) {
        return { persona, applied: false };
    }
    let agent;
    try {
        agent = getVerticalDefinition(industry, subType).agent;
    } catch {
        return { persona, applied: false };
    }
    const pick = (localized: Record<string, string> | undefined): string =>
        (localized?.[language] || localized?.es || '').trim();

    const current = persona || {};
    const personality = { ...(current.personality || {}) };
    const name = pick(agent.name);
    const role = pick(agent.role);
    const greeting = pick(agent.greeting);
    if (agent.tone) personality.tone = agent.tone;
    if (agent.formality) personality.formality = agent.formality;
    return {
        applied: true,
        persona: {
            ...current,
            ...(name ? { name } : {}),
            ...(role ? { role } : {}),
            ...(greeting ? { greeting } : {}),
            personality,
        },
    };
}

/**
 * Behaviour the six native-operation subtypes (farmacia, repuestos, alquiler,
 * hardware, guardería, hotel) are born with.
 *
 * The onboarding resolver gives them the generic `tpl_sales` template on
 * purpose: every goal template of their industry promises an appointment, a
 * demo or a test drive that these subtypes do not operate. That template also
 * carries the SPIN discovery script ("never start with features or prices"),
 * objection handling and a "hot lead" hand-off, which are not how a pharmacy
 * answers "do you have ibuprofen?" or how a pet hotel takes a stay. Identity
 * (name, role, voice, greeting) comes from `applySubtypeRecipeIdentity`; this
 * replaces the sales conduct with the contract's `birthBehavior` and its
 * `nativeRules`, in the tenant's language.
 *
 * Birth only, same as the identity: `createDefaultAgentFromGoals` is
 * create-only, so the template config is the whole row and nothing the owner
 * typed can be overwritten. The bootstrap that follows adds `nativeRules`
 * again and de-duplicates them, so the result is stable.
 *
 * Anything that is not one of the six, or a template other than the generic
 * onboarding one, is returned untouched.
 */
export function applyNativeSubtypeBirthBehavior(
    config: Record<string, any>,
    industry: string | undefined,
    subType: string | undefined,
    templateId: string | undefined,
    language: string,
): { config: Record<string, any>; applied: boolean } {
    const contract = resolveVerticalSubtypePersonaContract(industry, subType);
    if (!contract || templateId !== contract.onboardingTemplateId) {
        return { config, applied: false };
    }
    const locale = normalizeVerticalPersonaLocale(language);
    const birth = contract.birthBehavior[locale];
    return {
        applied: true,
        config: {
            ...config,
            behavior: {
                ...(config.behavior || {}),
                rules: [...birth.rules, ...contract.nativeRules[locale]],
                handoffTriggers: [...birth.handoffTriggers],
            },
        },
    };
}
