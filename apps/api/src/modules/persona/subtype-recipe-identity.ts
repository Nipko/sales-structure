import { getSubtypeRecipeOverlay, getVerticalDefinition } from '../verticals/vertical-definitions';

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
