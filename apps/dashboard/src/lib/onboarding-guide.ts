import {
  isOnboardingStage,
  resolveOnboardingGuide,
  type OnboardingGuide,
  type OnboardingStage,
} from "@parallext/shared";

/**
 * Onboarding guidance — the dashboard half of
 * `packages/shared/src/onboarding-stage-contract.ts`.
 *
 * The shared resolver owns the RULE ("which single guide does this account
 * see?"). This module owns the dashboard's DATA: how the setup-status payload
 * is read, and what every surface should assume while that payload is still in
 * flight or could not be read at all.
 *
 * Nothing here decides anything on its own. Keeping the reading in one place is
 * what stops `AuthContext.getRedirectPath`, `/admin` and the setup card from
 * each inventing their own idea of "is this account ready", which is how a new
 * tenant ended up meeting three different guides at once.
 */

export interface SetupStatusDefaultAgent {
  id: string;
  name: string;
  greeting: string;
}

export interface SetupStatusFacts {
  hasAnyChannel: boolean;
  /** The channel types with at least one active connection (`whatsapp`, `instagram`…). */
  connectedChannelTypes: string[];
  setupWizardCompleted: boolean;
  setupWizardSkipped: boolean;
  /** `tenant.settings.onboardingStage`; absent on tenants created before it existed. */
  stage?: OnboardingStage;
  channelConnectSkippedAt: string | null;
  hasAgent: boolean;
  /** The agent the signup already created, so the wizard can confirm it instead of asking again. */
  defaultAgent: SetupStatusDefaultAgent | null;
  /** The template the tenant's own agent was built from — never a guess. */
  defaultAgentTemplateId: string | null;
  /** Tenant timezone, so the wizard stops writing a hardcoded America/Bogota. */
  timezone: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readDefaultAgent(data: Record<string, unknown>): SetupStatusDefaultAgent | null {
  const agent = data.defaultAgent;
  if (isRecord(agent)) {
    const id = optionalString(agent.id);
    if (id) {
      return {
        id,
        name: optionalString(agent.name) ?? "",
        greeting: typeof agent.greeting === "string" ? agent.greeting : "",
      };
    }
  }
  // Compatibility with the fields the endpoint exposed before `defaultAgent`.
  const legacyId = optionalString(data.defaultAgentId);
  const legacyName = optionalString(data.defaultAgentName);
  if (legacyId || legacyName) {
    return { id: legacyId ?? "", name: legacyName ?? "", greeting: "" };
  }
  return null;
}

function readChannelTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value.map((entry) => optionalString(entry)).filter((entry): entry is string => entry !== null),
  ));
}

/**
 * Read `GET /persona/:tenantId/setup-status`. Returns `null` when the response
 * cannot be trusted — a caller must then keep showing what it already had
 * rather than inventing a stage from a failed request.
 */
export function readSetupStatusFacts(response: unknown): SetupStatusFacts | null {
  if (!isRecord(response) || response.success !== true || !isRecord(response.data)) return null;
  const data = response.data;
  const stage = typeof data.onboardingStage === "string" ? data.onboardingStage : undefined;
  const connectedChannelTypes = readChannelTypes(data.connectedChannelTypes);

  return {
    hasAnyChannel: data.hasAnyChannel === true,
    connectedChannelTypes,
    setupWizardCompleted: data.setupWizardCompleted === true,
    setupWizardSkipped: data.setupWizardSkipped === true,
    stage: stage as OnboardingStage | undefined,
    channelConnectSkippedAt: optionalString(data.channelConnectSkippedAt),
    hasAgent: readDefaultAgent(data) !== null || data.hasPersona === true,
    defaultAgent: readDefaultAgent(data),
    defaultAgentTemplateId: optionalString(data.defaultAgentTemplateId),
    timezone: optionalString(data.timezone),
  };
}

export interface DashboardGuideInput {
  facts: SetupStatusFacts;
  role: string | null | undefined;
  /** False once the setup card has no pending item left. */
  setupIncomplete?: boolean;
}

export function resolveDashboardOnboardingGuide({
  facts,
  role,
  setupIncomplete,
}: DashboardGuideInput): OnboardingGuide {
  return resolveOnboardingGuide({
    stage: facts.stage,
    hasAnyChannel: facts.hasAnyChannel,
    setupWizardCompleted: facts.setupWizardCompleted,
    setupWizardSkipped: facts.setupWizardSkipped,
    hasAgent: facts.hasAgent,
    channelConnectSkippedAt: facts.channelConnectSkippedAt,
    role,
    setupIncomplete,
  });
}

/**
 * What a surface assumes when the setup status is NOT KNOWN: still in flight,
 * or the request failed.
 *
 * `landing: 'unknown'` is the load-bearing part. The old value said
 * `stage: 'completed', landing: 'normal'`, so a failed read declared the
 * account finished: a tenant with nothing configured got the "everything is
 * fine" home — hero, agent health and all — because one HTTP call did not come
 * back. Unknown is not done.
 *
 * Every surface must therefore gate on the landing, not on the absence of a
 * flag: `guide.landing === 'unknown'` means DRAW NOTHING and wait. Reading
 * `stage` while the landing is `'unknown'` is a bug — the value below is the
 * least-progress placeholder the type allows, not a claim about the tenant.
 */
export const UNKNOWN_ONBOARDING_GUIDE: OnboardingGuide = {
  stage: "account_created",
  redirect: null,
  landing: "unknown",
  offerTour: false,
  showResumeBanner: false,
  primaryTourId: null,
};

/**
 * @deprecated Use `UNKNOWN_ONBOARDING_GUIDE`; "pending" read as "in flight" and
 * hid that a FAILED read lands here too. Same value, honest name.
 */
export const PENDING_ONBOARDING_GUIDE: OnboardingGuide = UNKNOWN_ONBOARDING_GUIDE;

/** True once the guidance rests on facts, i.e. it may be drawn. */
export function isOnboardingGuideKnown(guide: OnboardingGuide): boolean {
  return guide.landing !== "unknown";
}

export interface LoginRedirectUser {
  role?: string | null;
  tenantId?: string | null;
  /** `tenant.settings.onboardingStage` as sent by the auth payload, if at all. */
  onboardingStage?: unknown;
  onboardingCompleted?: boolean;
  emailVerified?: boolean;
}

/**
 * Where a fresh login belongs.
 *
 * The wizard is only ever reached ON EVIDENCE: a stage the server actually
 * sent. When the payload carries no stage — an older API, a failed derivation,
 * a role without a tenant — the answer is `/admin`, which has the real setup
 * status and does its own bounce. The previous version defaulted a missing
 * stage to `account_created` and passed `hasAnyChannel: false` as if it were a
 * fact, so EVERY tenant_admin login landed in "meet your agent", forever,
 * including two-year-old accounts with WhatsApp live.
 */
export function resolveLoginRedirect(user: LoginRedirectUser): string {
  if (user.role === "super_admin") return "/admin";

  if (user.tenantId) {
    if (!isOnboardingStage(user.onboardingStage)) return "/admin";
    const guide = resolveOnboardingGuide({
      stage: user.onboardingStage,
      // Deliberately omitted: this payload does not know about channels, and
      // saying `false` would be a claim, not an omission. The stage was already
      // reconciled against the tenant's channels server-side.
      role: user.role,
    });
    return guide.redirect ?? "/admin";
  }

  // Email verification is progressive: a new owner may complete the
  // non-operational onboarding and enter a tenant with a persistent warning.
  // Sensitive actions remain server-gated per capability.
  if (!user.onboardingCompleted) return "/onboarding";
  if (!user.emailVerified) return "/verify-email";
  return "/admin";
}
