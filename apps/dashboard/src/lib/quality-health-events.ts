import type { AgentQualitySeverity } from "@parallext/shared";
import { QUALITY_ASSIST_EVENT } from "@/lib/quality-assistant-contract";

export const QUALITY_HEALTH_REFRESH_EVENT = "parallly:quality-health:refresh" as const;

export interface QualityAssistEventDetail {
  signalId: string;
  agentId: string;
  agentName: string;
  code: string;
  severity: AgentQualitySeverity;
  href: string;
}

/**
 * Opens Parallly Assist with bounded quality context. Never include transcripts,
 * customer identifiers, prompts or free-form evaluator text in this event.
 */
export function askAssistAboutQuality(detail: QualityAssistEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<QualityAssistEventDetail>(QUALITY_ASSIST_EVENT, { detail }));
}

export function requestQualityHealthRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(QUALITY_HEALTH_REFRESH_EVENT));
}
