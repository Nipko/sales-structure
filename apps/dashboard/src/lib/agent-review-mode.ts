/**
 * How the tenant applies agent changes, as every surface that describes a save
 * has to read it.
 *
 * `immediate` is the default (owner decisions D1/D15, sep-2026): a save IS the
 * agent answering customers, and the switch in the editor turns it on or off.
 * `reviewed` is the optional advanced mode: a save is a draft that reaches
 * customers through test, review and publication.
 *
 * Several surfaces kept describing the second as if it were the only one — a
 * tool notice that said "save the draft and complete its publication", an
 * Assist review card that said "a draft is saved; what answers does not
 * change" over a change that went live the moment it was applied. The copy each
 * one shows is chosen HERE, per mode, and the day-0 jargon check in
 * `i18n-parity.spec.ts` reads the same table: a key only reviewed mode can show
 * is the only kind allowed to say "borrador" or "publicar".
 */

export type AgentReviewMode = "immediate" | "reviewed";

/**
 * What a surface knows. `unknown` is its own answer — the read failed, or the
 * role cannot read it — and gets copy that is true in both modes rather than a
 * guess at one of them.
 */
export type AgentReviewModeReading = AgentReviewMode | "unknown";

/** The editor's own reading: the workspace says it outright. */
export function reviewModeFromWorkspace(
  workspace: { directCommit?: unknown } | null | undefined,
): AgentReviewModeReading {
  if (!workspace || typeof workspace.directCommit !== "boolean") return "unknown";
  return workspace.directCommit ? "immediate" : "reviewed";
}

/** `GET /persona/:tenantId/agent-review-mode`, or anything that failed on the way. */
export function reviewModeFromResponse(response: unknown): AgentReviewModeReading {
  const envelope = response as { success?: unknown; data?: { mode?: unknown } } | null | undefined;
  if (!envelope || envelope.success !== true) return "unknown";
  const mode = envelope.data?.mode;
  return mode === "immediate" || mode === "reviewed" ? mode : "unknown";
}

/**
 * The sentence each surface shows, by mode. Full i18n paths, so the parity
 * spec can check them without re-deriving anything.
 */
export const AGENT_REVIEW_MODE_COPY = {
  /** `AgentToolModuleNotice`, under "Cómo funciona". */
  toolModuleScope: {
    immediate: "agentToolNavigation.liveScope",
    reviewed: "agentToolNavigation.draftScope",
    unknown: "agentToolNavigation.scopeUnknown",
  },
  /** `CapabilitiesSection`, above the agent's tool switches. */
  toolEditorScope: {
    immediate: "agentToolNavigation.editorScope",
    reviewed: "agentToolNavigation.editorScopeReviewed",
    unknown: "agentToolNavigation.editorScopeUnknown",
  },
  /** `AgentConfigurationReview`: what applying an Assist proposal will do. */
  proposalReview: {
    immediate: "agentDraft.proposalLiveReview",
    reviewed: "agentDraft.proposalDraftReview",
    unknown: "agentDraft.proposalUnknownReview",
  },
  /** `AgentConfigurationReview`: the button that applies it. */
  proposalApply: {
    immediate: "agentDraft.saveLive",
    reviewed: "agentDraft.save",
    unknown: "agentDraft.saveUnknown",
  },
  /** `AgentConfigurationReview`: what happened, once applied. */
  proposalApplied: {
    immediate: "agentDraft.savedLive",
    reviewed: "agentDraft.saved",
    unknown: "agentDraft.savedUnknown",
  },
} as const satisfies Record<string, Record<AgentReviewModeReading, string>>;

export type AgentReviewModeSurface = keyof typeof AGENT_REVIEW_MODE_COPY;

/** The i18n path a surface shows for a reading. */
export function agentReviewModeCopyKey(surface: AgentReviewModeSurface, reading: AgentReviewModeReading): string {
  return AGENT_REVIEW_MODE_COPY[surface][reading];
}

/** Paths only a reviewed-mode tenant can ever read: the one place pipeline words belong. */
export function reviewedOnlyAgentReviewModeKeys(): string[] {
  const shownOtherwise = new Set(Object.values(AGENT_REVIEW_MODE_COPY)
    .flatMap((copy) => [copy.immediate, copy.unknown] as string[]));
  return Object.values(AGENT_REVIEW_MODE_COPY)
    .map((copy) => copy.reviewed as string)
    .filter((key) => !shownOtherwise.has(key));
}

/** Drops the namespace, for a `useTranslations(namespace)` translator. */
export function withinNamespace(path: string, namespace: string): string {
  return path.startsWith(`${namespace}.`) ? path.slice(namespace.length + 1) : path;
}
