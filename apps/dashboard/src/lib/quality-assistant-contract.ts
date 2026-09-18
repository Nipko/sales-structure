import type { AgentQualitySeverity } from "@parallext/shared";

export const QUALITY_ASSIST_EVENT = "parallly:assist:quality-signal" as const;

export interface QualityAssistantTarget {
  kind: "agent_quality";
  agentId: string;
  signalId?: string;
}

export interface QualityAssistantOpenDetail {
  signalId?: string;
  agentId: string;
  agentName?: string;
  code?: string;
  severity?: AgentQualitySeverity;
  href?: string;
  prompt?: string;
  /**
   * Send `prompt` as the owner's message instead of leaving it typed.
   *
   * Only for a request the owner already wrote herself ("Dime qué cambiar"):
   * making her press Enter a second time on her own words was a step with
   * nothing to decide. A prompt the panel suggests on her behalf stays typed,
   * so she can still change it before anything is asked.
   */
  send?: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseQualityAssistantDetail(value: unknown): QualityAssistantOpenDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const detail = value as Record<string, unknown>;
  if (typeof detail.agentId !== "string" || !UUID_PATTERN.test(detail.agentId)) return null;
  if (detail.signalId !== undefined && (typeof detail.signalId !== "string" || !UUID_PATTERN.test(detail.signalId))) return null;

  const href = typeof detail.href === "string"
    && (detail.href === "/admin" || detail.href.startsWith("/admin/"))
    && !detail.href.startsWith("//")
    && !detail.href.includes("..")
    ? detail.href
    : undefined;
  const severity = ["critical", "high", "medium", "low"].includes(String(detail.severity))
    ? detail.severity as AgentQualitySeverity
    : undefined;

  return {
    agentId: detail.agentId,
    signalId: typeof detail.signalId === "string" ? detail.signalId : undefined,
    agentName: typeof detail.agentName === "string" ? detail.agentName.slice(0, 120) : undefined,
    code: typeof detail.code === "string" ? detail.code.slice(0, 120) : undefined,
    severity,
    href,
    prompt: typeof detail.prompt === "string" ? detail.prompt.slice(0, 2_000) : undefined,
    // Strictly `true`: anything else leaves the prompt typed, never sent.
    send: detail.send === true ? true : undefined,
  };
}

/**
 * Whether this opening is the owner asking for a change in her own words
 * ("Dime qué cambiar"), rather than a quality surface pointing at a problem.
 *
 * The event is shared — both need Assist opened on one agent — but only the
 * second is a health signal. A change request carries no status, priority or
 * signal, so the "Contexto de salud del agente" notice that explains what
 * Assist receives about a signal described nothing there: it put an amber
 * health warning over "que salude más corto". `send` is the marker because
 * it is, by contract, only set for words she already wrote.
 */
export function isOwnerChangeRequest(detail: QualityAssistantOpenDetail): boolean {
  return detail.send === true;
}

export function qualityAssistantTarget(detail: QualityAssistantOpenDetail): QualityAssistantTarget {
  return { kind: "agent_quality", agentId: detail.agentId, signalId: detail.signalId };
}

export function openQualityAssistant(detail: QualityAssistantOpenDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(QUALITY_ASSIST_EVENT, { detail }));
}
