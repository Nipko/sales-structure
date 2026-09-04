/**
 * Onboarding stage — the single source of truth for "where is this account in
 * its setup", shared by the API and the dashboard.
 *
 * Before this contract the answer lived in three places that disagreed:
 * `AuthContext.getRedirectPath`, the bounce in `/admin`, and the setup card's
 * own heuristics. A novice therefore met several guides at once, each with its
 * own idea of what was still missing.
 *
 * Rules:
 * - The stage only moves forward. A later write with a lower stage is ignored,
 *   so an out-of-order event cannot send a working tenant back to the wizard.
 * - `channel_deferred` is NOT a lower stage than `agent_reviewed`: it is the
 *   explicit "connect later" decision, which must survive and keep the
 *   reminder alive on Home. Only a real connection ends it — see
 *   `advanceOnboardingStage`.
 * - Legacy tenants have no stage. `deriveOnboardingStage` reconstructs one from
 *   the flags that already exist, so nothing needs a migration or a backfill.
 * - Every fact is optional except the ones a caller can actually establish.
 *   "I don't know whether this tenant has a channel" is a different answer from
 *   "this tenant has no channel", and stating the second when you mean the
 *   first is how a two-year-old account ends up back in the setup wizard.
 */

export const ONBOARDING_STAGES = [
    'account_created',
    'agent_reviewed',
    'channel_deferred',
    'channel_connected',
    'completed',
] as const;

export type OnboardingStage = typeof ONBOARDING_STAGES[number];

/** Monotonic rank. `channel_deferred` sits beside `agent_reviewed`, not above. */
const STAGE_RANK: Record<OnboardingStage, number> = {
    account_created: 0,
    agent_reviewed: 1,
    channel_deferred: 1,
    channel_connected: 2,
    completed: 3,
};

/**
 * The only stages that PROVE a channel exists.
 *
 * `completed` is deliberately absent: finishing the wizard is not connecting a
 * channel, and the wizard's own last button used to send `completed` right
 * after "Conectar después" — which erased the deferral, and with it the
 * reminder on Home that the copy had just promised.
 */
const STAGES_PROVING_CHANNEL: readonly OnboardingStage[] = ['channel_connected'];

function provesChannel(stage: OnboardingStage): boolean {
    return STAGES_PROVING_CHANNEL.includes(stage);
}

export function isOnboardingStage(value: unknown): value is OnboardingStage {
    return typeof value === 'string' && (ONBOARDING_STAGES as readonly string[]).includes(value);
}

export function onboardingStageRank(stage: OnboardingStage): number {
    return STAGE_RANK[stage];
}

/**
 * Advance without ever going backwards, and without ever losing a recorded
 * decision.
 *
 * Two asymmetries, both deliberate:
 * - Deferring never overwrites a tenant that already connected a channel.
 * - Once deferred, ONLY a stage that proves a channel leaves the deferral.
 *   `agent_reviewed` and `completed` are things the same wizard writes moments
 *   later; if they could clear it, "conectar después" would survive exactly one
 *   click.
 */
export function advanceOnboardingStage(
    current: unknown,
    next: OnboardingStage,
): OnboardingStage {
    if (!isOnboardingStage(current)) return next;
    if (current === next) return current;
    // Deferring is a decision, not progress: it never overwrites a tenant that
    // already connected a channel.
    if (next === 'channel_deferred') {
        return STAGE_RANK[current] >= STAGE_RANK.channel_connected ? current : 'channel_deferred';
    }
    if (current === 'channel_deferred' && !provesChannel(next)) {
        return 'channel_deferred';
    }
    return STAGE_RANK[next] >= STAGE_RANK[current] ? next : current;
}

export interface OnboardingStageFacts {
    /** `tenant.settings.onboardingStage`, absent on tenants created before this contract. */
    stage?: unknown;
    /**
     * Whether the tenant has at least one active channel connection.
     *
     * `undefined` means NOT KNOWN HERE (the login payload, for instance, does
     * not read channels). It must never be spelled `false`: a `false` here
     * claims the account cannot receive a single message, which is what turned
     * a login into a one-way trip to the setup wizard.
     */
    hasAnyChannel?: boolean;
    setupWizardCompleted?: boolean;
    setupWizardSkipped?: boolean;
    /** True when the tenant has at least one agent with a saved configuration. */
    hasAgent?: boolean;
    channelConnectSkippedAt?: string | null;
}

/**
 * The stage a tenant is in, reconstructing it for accounts that predate the
 * stored field. Never returns `completed` from derivation alone: completion is
 * an explicit event, and guessing it would silence the guidance a tenant with a
 * half-finished setup still needs.
 */
export function deriveOnboardingStage(facts: OnboardingStageFacts): OnboardingStage {
    // Only a POSITIVE channel fact upgrades anything. `undefined` (unknown) is
    // treated exactly like "no information", never like "no channel".
    const hasChannel = facts.hasAnyChannel === true;

    if (isOnboardingStage(facts.stage)) {
        // A stored stage still yields to reality: a channel that exists wins
        // over a stale `account_created` written before the connection.
        return hasChannel
            ? advanceOnboardingStage(facts.stage, 'channel_connected')
            : facts.stage;
    }
    if (hasChannel) return 'channel_connected';
    if (facts.channelConnectSkippedAt || facts.setupWizardSkipped) return 'channel_deferred';
    if (facts.setupWizardCompleted || facts.hasAgent) return 'agent_reviewed';
    return 'account_created';
}

export type OnboardingLanding =
    /** The channel fact is not known yet: draw no guidance at all. */
    | 'unknown'
    /** Nothing but the setup card: the account cannot receive a message yet. */
    | 'setup_card_only'
    /** Setup card plus agent health: there is a channel, some steps remain. */
    | 'setup_card_and_health'
    /** Business as usual. */
    | 'normal';

export interface OnboardingGuideInput extends OnboardingStageFacts {
    role?: string | null;
    /** True while the tenant still has open essential setup items. */
    setupIncomplete?: boolean;
}

export interface OnboardingGuide {
    stage: OnboardingStage;
    /** Where a fresh login belongs. `null` means "stay where you are". */
    redirect: '/admin/setup-wizard' | null;
    landing: OnboardingLanding;
    /** The product tour is offered, never auto-started. */
    offerTour: boolean;
    /** "Retomar configuración" — shown whether or not a channel exists. */
    showResumeBanner: boolean;
    /** The tour the landing guidance should point at, if any. */
    primaryTourId: 'first_channel_whatsapp' | 'home_first_steps' | null;
}

/**
 * The one rule every guidance surface reads. Suppressing surfaces here — rather
 * than in each component — is what keeps a new account from meeting six guides
 * at once.
 *
 * When the caller does not know whether a channel exists, the landing is
 * `'unknown'`: no surface may be drawn from a guess. A caller that has the
 * fact passes it; a caller that does not, stays quiet.
 */
export function resolveOnboardingGuide(input: OnboardingGuideInput): OnboardingGuide {
    const stage = deriveOnboardingStage(input);
    const isAdmin = input.role === 'tenant_admin' || input.role === 'super_admin';
    const setupIncomplete = input.setupIncomplete !== false;
    const channelKnown = typeof input.hasAnyChannel === 'boolean';

    // Only a tenant admin who has never reviewed the agent is sent to the
    // wizard; everyone else lands on Home and is guided from the setup card.
    // `account_created` is a stage no tenant with a channel can still be in:
    // whoever produced this stage already reconciled it against the channels.
    const redirect = isAdmin && stage === 'account_created' ? '/admin/setup-wizard' : null;

    const landing: OnboardingLanding = !channelKnown
        ? 'unknown'
        : !input.hasAnyChannel
            ? 'setup_card_only'
            : setupIncomplete
                ? 'setup_card_and_health'
                : 'normal';

    return {
        stage,
        redirect,
        landing,
        offerTour: landing === 'setup_card_and_health' || landing === 'normal',
        showResumeBanner: isAdmin
            && (stage === 'channel_deferred' || input.setupWizardSkipped === true)
            && stage !== 'completed',
        primaryTourId: landing === 'setup_card_only'
            ? (isAdmin ? 'first_channel_whatsapp' : null)
            : landing === 'setup_card_and_health' ? 'home_first_steps' : null,
    };
}
