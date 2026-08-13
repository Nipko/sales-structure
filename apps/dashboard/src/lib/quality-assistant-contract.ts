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
  };
}

export function qualityAssistantTarget(detail: QualityAssistantOpenDetail): QualityAssistantTarget {
  return { kind: "agent_quality", agentId: detail.agentId, signalId: detail.signalId };
}

export function openQualityAssistant(detail: QualityAssistantOpenDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(QUALITY_ASSIST_EVENT, { detail }));
}
