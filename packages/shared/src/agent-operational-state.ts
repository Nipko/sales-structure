import type { AgentQualityCheckStatus, AgentQualityPillarStatus, AgentQualityStatus } from './agent-quality-contract';

/**
 * The one vocabulary every surface says the state of an agent in.
 *
 * Inicio, the onboarding card, the agent editor, Salud, the tours and Assist all
 * read the same assessment object and then each rendered its own words for it.
 * Six vocabularies were in use at once — `AgentQualityStatus`,
 * `AgentQualityCheckStatus`, `AgentQualityPillarStatus`, `ChannelCredentialHealth`,
 * the onboarding stage, plus a scatter of `done: boolean` and
 * `'known' | 'unavailable'` pairs — and none of them was the same as any other.
 * A tenant reading "Listo para piloto controlado" in one place, "Cumple" in
 * another and a green tick in a third has no way to know whether those three
 * sentences agree.
 *
 * This is a projection, not a rename. Every existing vocabulary keeps its own
 * meaning and gains one total mapping onto these six, so a surface can show the
 * shared word without any contract having to change underneath it.
 *
 * The identifiers are English like the rest of the code; the six words the
 * directive names are their labels, and live in the four message files:
 *
 *   unknown → desconocido · pending → pendiente · prepared → preparado
 *   tested → probado · operating → operativo · degraded → deteriorado
 */
export const AGENT_OPERATIONAL_STATES = [
    'unknown',
    'pending',
    'prepared',
    'tested',
    'operating',
    'degraded',
] as const;
export type AgentOperationalState = typeof AGENT_OPERATIONAL_STATES[number];

/**
 * How far along the ladder a state is. `unknown` and `degraded` are deliberately
 * outside it: neither is a rung, and treating them as one is how "we could not
 * look" ends up rendering as "nothing is configured".
 */
const PROGRESS: Readonly<Record<AgentOperationalState, number>> = Object.freeze({
    unknown: -1, degraded: -1, pending: 0, prepared: 1, tested: 2, operating: 3,
});

export function isAgentOperationalState(value: unknown): value is AgentOperationalState {
    return typeof value === 'string' && (AGENT_OPERATIONAL_STATES as readonly string[]).includes(value);
}

/** The agent's own status, as Salud computes it. */
export function operationalStateFromQuality(status: AgentQualityStatus | null | undefined): AgentOperationalState {
    switch (status) {
        case 'operating_with_evidence': return 'operating';
        case 'ready_for_pilot': return 'tested';
        case 'configuration_incomplete': return 'pending';
        // Both of these mean something that was working needs a person to look.
        case 'at_risk':
        case 'review_required': return 'degraded';
        case 'not_evaluated': return 'pending';
        default: return 'unknown';
    }
}

/**
 * One check inside the assessment.
 *
 * `not_applicable` is not a state of the agent — a check that does not apply
 * says nothing — so it maps to `null` and a caller drops it rather than letting
 * it drag a rollup down.
 */
export function operationalStateFromCheck(status: AgentQualityCheckStatus | null | undefined,
    options: { sourceAvailable?: boolean } = {}): AgentOperationalState | null {
    if (options.sourceAvailable === false) return 'unknown';
    switch (status) {
        case 'pass': return 'prepared';
        case 'warning': return 'degraded';
        case 'fail': return 'pending';
        case 'not_applicable': return null;
        default: return 'unknown';
    }
}

export function operationalStateFromPillar(status: AgentQualityPillarStatus | null | undefined): AgentOperationalState {
    switch (status) {
        case 'evidenced': return 'operating';
        case 'ready': return 'prepared';
        case 'stale':
        case 'needs_attention': return 'degraded';
        case 'blocked': return 'pending';
        // Not the same thing as "we could not look", but the honest answer for
        // both is that nothing can be claimed yet.
        case 'insufficient_evidence': return 'pending';
        default: return 'unknown';
    }
}

/**
 * A connection's credentials.
 *
 * `unknown` here means the credential table could not be read, which is exactly
 * the case a channels screen used to paint green.
 */
export function operationalStateFromCredentialHealth(
    health: 'ok' | 'expiring' | 'unknown' | 'missing' | 'error' | 'revoked' | 'expired' | null | undefined,
): AgentOperationalState {
    switch (health) {
        case 'ok': return 'operating';
        case 'expiring': return 'degraded';
        case 'expired':
        case 'revoked':
        case 'error': return 'degraded';
        case 'missing': return 'pending';
        default: return 'unknown';
    }
}

/**
 * Whether something is connected at all, when the answer may not be known.
 *
 * `undefined` is the third answer the onboarding contract insists on: a `false`
 * claims the account cannot receive a single message, and one unreadable count
 * used to be spelled exactly that way.
 */
export function operationalStateFromKnownFlag(value: boolean | null | undefined,
    whenTrue: AgentOperationalState = 'operating'): AgentOperationalState {
    if (value === true) return whenTrue;
    if (value === false) return 'pending';
    return 'unknown';
}

/**
 * The state of a whole made of parts.
 *
 * A single degraded part makes the whole degraded: something that was working
 * stopped, and no amount of green elsewhere changes that. Otherwise anything
 * unknown makes the whole unknown, because a claim of "operating" cannot rest on
 * a part nobody could read. Only when every part is known and healthy does the
 * ladder decide, and then it is the least advanced part that speaks — an agent
 * is not tested because one of its channels is.
 */
export function rollUpOperationalState(
    parts: readonly (AgentOperationalState | null | undefined)[],
): AgentOperationalState {
    const known = parts.filter(isAgentOperationalState);
    if (!known.length) return 'unknown';
    if (known.includes('degraded')) return 'degraded';
    if (known.includes('unknown')) return 'unknown';
    return known.reduce((worst, state) => PROGRESS[state] < PROGRESS[worst] ? state : worst, known[0]);
}

/** Whether this state may be presented as an agent doing its job. */
export function isOperationalStateServing(state: AgentOperationalState): boolean {
    return state === 'operating';
}

/** Whether a person has to look at it. */
export function operationalStateNeedsAttention(state: AgentOperationalState): boolean {
    return state === 'degraded' || state === 'unknown';
}
