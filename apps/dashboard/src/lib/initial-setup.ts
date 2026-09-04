import type { GuidedTourId } from "@parallext/shared";

/**
 * The essential setup checklist — the ONE place that answers "what is still
 * missing before this account works".
 *
 * Before this, progress was derived from three shallow booleans of its own
 * (`hasPersona`, `hasKnowledge`, a channel count) while Agent health computed a
 * far more precise answer next to it. The two disagreed constantly: the card
 * said the agent was ready while health reported it could not hand a
 * conversation to a person. The items below are now derived from the SAME
 * preparation checks Agent health uses, so a tenant reads one verdict.
 *
 * Fail-closed remains the rule: a source that could not be verified raises,
 * and the card says so, instead of inventing a pending task out of a failed
 * request.
 */

export const CERTIFIED_SETUP_CHANNELS = ["whatsapp", "instagram", "messenger", "telegram", "web_chat"] as const;
type CertifiedSetupChannel = typeof CERTIFIED_SETUP_CHANNELS[number];

const CHANNEL_ROUTES: Partial<Record<CertifiedSetupChannel, string>> = {
  whatsapp: "/admin/channels/whatsapp",
  instagram: "/admin/channels/instagram",
  messenger: "/admin/channels/messenger",
  telegram: "/admin/channels/telegram",
};

export interface InitialSetupStatus {
  hasPersona?: boolean;
  hasKnowledge?: boolean;
  hasVerticalCatalog?: boolean | null;
  verticalCatalogRoute?: string | null;
  setupWizardChannels?: string[];
}

export type EssentialSetupItemKey =
  | "channel"
  | "agent"
  | "business"
  | "knowledge"
  | "catalog"
  | "team"
  | "hours";

export interface EssentialSetupItem {
  key: EssentialSetupItemKey;
  href: string;
  done: boolean;
  /** The tour "Mostrarme dónde" runs for this item. `null` = no tour covers it. */
  tourId: GuidedTourId | null;
}

export type QualityCheckStatus = "pass" | "warning" | "fail" | "unknown" | "not_applicable";
export type QualityCheckStatuses = Record<string, QualityCheckStatus>;

export interface ResolvedInitialSetupSources {
  status: InitialSetupStatus;
  planChannels: string[];
  activeChannels: string[];
  /** Preparation checks of the default agent. Empty when the tenant has no agent yet. */
  checks: QualityCheckStatuses;
}

const CHECK_STATUSES: readonly QualityCheckStatus[] = [
  "pass", "warning", "fail", "unknown", "not_applicable",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Flatten `preparation.dimensions[].checks[]` into `code → status`.
 *
 * `undefined` means the overview was never requested because the tenant has no
 * agent: an empty map, where every item reads as pending, is the truthful
 * answer. Anything else must be a well-formed successful response — a failed
 * request must NOT quietly become "nothing is configured".
 */
function readQualityChecks(response: unknown): QualityCheckStatuses {
  if (response === undefined) return {};
  if (!isRecord(response) || response.success !== true || !isRecord(response.data)) {
    throw new Error("agent_quality_unavailable");
  }
  const preparation = response.data.preparation;
  if (!isRecord(preparation) || !Array.isArray(preparation.dimensions)) {
    throw new Error("agent_quality_invalid");
  }
  const checks: QualityCheckStatuses = {};
  for (const dimension of preparation.dimensions) {
    if (!isRecord(dimension) || !Array.isArray(dimension.checks)) continue;
    for (const check of dimension.checks) {
      if (!isRecord(check)) continue;
      const code = check.code;
      const status = check.status;
      if (typeof code !== "string" || !code) continue;
      if (typeof status !== "string" || !CHECK_STATUSES.includes(status as QualityCheckStatus)) continue;
      checks[code] = status as QualityCheckStatus;
    }
  }
  return checks;
}

/** Fail closed: an unavailable source must never become a fabricated pending task. */
export function resolveInitialSetupSources(
  statusResponse: unknown,
  planResponse: unknown,
  channelsResponse: unknown,
  qualityResponse?: unknown,
): ResolvedInitialSetupSources {
  if (!isRecord(statusResponse) || statusResponse.success !== true || !isRecord(statusResponse.data)) {
    throw new Error("setup_status_unavailable");
  }
  if (!isRecord(planResponse) || planResponse.success !== true || !isRecord(planResponse.data)) {
    throw new Error("plan_features_unavailable");
  }
  if (!Array.isArray(planResponse.data.channels) || !planResponse.data.channels.every((channel) => typeof channel === "string")) {
    throw new Error("plan_channels_invalid");
  }
  if (!isRecord(channelsResponse) || channelsResponse.success !== true || !Array.isArray(channelsResponse.data)) {
    throw new Error("channel_overview_unavailable");
  }
  if (!channelsResponse.data.every((channel) => isRecord(channel)
    && typeof channel.channelType === "string"
    && typeof channel.isActive === "boolean")) {
    throw new Error("channel_overview_invalid");
  }

  return {
    status: statusResponse.data as InitialSetupStatus,
    planChannels: [...planResponse.data.channels],
    activeChannels: channelsResponse.data
      .filter((channel) => (channel as Record<string, unknown>).isActive === true)
      .map((channel) => String((channel as Record<string, unknown>).channelType)),
    checks: readQualityChecks(qualityResponse),
  };
}

interface BuildEssentialSetupItemsInput {
  status: InitialSetupStatus;
  planChannels: readonly string[];
  activeChannels: readonly string[];
  checks: QualityCheckStatuses;
  canAccess: (href: string) => boolean;
}

function canonicalChannel(channel: string): string {
  return channel === "webchat" || channel === "web_widget" ? "web_chat" : channel;
}

/** A check that is not blocking: it passed, or it does not apply to this business. */
function checkSettled(status: QualityCheckStatus | undefined): boolean {
  return status === "pass" || status === "not_applicable";
}

/**
 * A group of checks counts as done when at least one of them was actually
 * evaluated and none of the evaluated ones is still open.
 *
 * The "at least one present" half matters: a vertical whose profile drops a
 * check entirely would otherwise make the item permanently green (every absent
 * check trivially passes) or permanently red, depending on the direction of the
 * test. Requiring evidence keeps both mistakes out.
 */
function groupSettled(checks: QualityCheckStatuses, codes: readonly string[]): boolean {
  const present = codes.filter((code) => checks[code] !== undefined);
  return present.length > 0 && present.every((code) => checkSettled(checks[code]));
}

/** True when the business runs on appointments, per the checks the agent is graded on. */
function usesAppointments(checks: QualityCheckStatuses): boolean {
  const appointments = checks.tool_appointments;
  return appointments !== undefined && appointments !== "not_applicable";
}

const AGENT_CHECKS = ["persona_identity", "fallback_message", "behavior_rules", "handoff_triggers"] as const;
const BUSINESS_CHECKS = ["business_identity"] as const;
const KNOWLEDGE_CHECKS = ["knowledge_coverage"] as const;
const TEAM_CHECKS = ["human_handoff_route"] as const;
const HOURS_CHECKS = ["business_hours", "tool_appointments"] as const;

export function buildEssentialSetupItems({
  status,
  planChannels,
  activeChannels,
  checks,
  canAccess,
}: BuildEssentialSetupItemsInput): EssentialSetupItem[] {
  const items: EssentialSetupItem[] = [];

  // 1 — Connect a channel. First, because nothing else can reach a customer.
  const availableChannels = new Set(planChannels.map(canonicalChannel));
  const certifiedAvailable = CERTIFIED_SETUP_CHANNELS.filter((channel) => availableChannels.has(channel));
  if (certifiedAvailable.length > 0 && canAccess("/admin/channels")) {
    const preferred = (status.setupWizardChannels || [])
      .map(canonicalChannel)
      .find((channel): channel is CertifiedSetupChannel => certifiedAvailable.includes(channel as CertifiedSetupChannel));
    const target = preferred || certifiedAvailable[0];
    const route = CHANNEL_ROUTES[target] || "/admin/channels";
    const connected = new Set(activeChannels.map(canonicalChannel));
    items.push({
      key: "channel",
      href: canAccess(route) ? route : "/admin/channels",
      done: certifiedAvailable.some((channel) => connected.has(channel)),
      tourId: target === "whatsapp" ? "first_channel_whatsapp" : "connect_channel",
    });
  }

  // 2 — Review the agent the signup already created.
  if (canAccess("/admin/agent")) {
    items.push({
      key: "agent",
      href: "/admin/agent",
      done: groupSettled(checks, AGENT_CHECKS),
      tourId: "agent_handoff_rules",
    });
  }

  // 3 — Tell us what the business does.
  if (canAccess("/admin/settings/business-info")) {
    items.push({
      key: "business",
      href: "/admin/settings/business-info",
      done: groupSettled(checks, BUSINESS_CHECKS),
      tourId: "business_identity",
    });
  }

  // 4 — Load what the agent must know: the vertical's catalogue when the
  // industry has one, generic knowledge otherwise.
  const catalogRoute = status.verticalCatalogRoute;
  if (catalogRoute?.startsWith("/admin") && !catalogRoute.startsWith("//") && canAccess(catalogRoute)) {
    items.push({
      key: "catalog",
      href: catalogRoute,
      done: status.hasVerticalCatalog === true || groupSettled(checks, KNOWLEDGE_CHECKS),
      tourId: null,
    });
  } else if (!catalogRoute && canAccess("/admin/knowledge")) {
    items.push({
      key: "knowledge",
      href: "/admin/knowledge",
      done: groupSettled(checks, KNOWLEDGE_CHECKS) || status.hasKnowledge === true,
      tourId: "knowledge_base",
    });
  }

  // 5 — Invite a person who can receive the chats the agent escalates.
  if (canAccess("/admin/users")) {
    items.push({
      key: "team",
      href: "/admin/users",
      done: groupSettled(checks, TEAM_CHECKS),
      tourId: "human_handoff_route",
    });
  }

  // 6 — Confirm the schedule. Only for businesses that run on appointments;
  // asking a shop to "confirm availability" it never uses is noise.
  if (usesAppointments(checks) && canAccess("/admin/settings/business-hours")) {
    items.push({
      key: "hours",
      href: "/admin/settings/business-hours",
      done: groupSettled(checks, HOURS_CHECKS),
      tourId: "business_hours",
    });
  }

  return items;
}
