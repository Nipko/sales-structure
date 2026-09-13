import type { AgentQualityOverview, AgentQualitySignal } from "@parallext/shared";

interface Response<T> { success: boolean; data?: T; httpStatus?: number }
export interface QualityFocusPayload { signal: AgentQualitySignal; overview: AgentQualityOverview | null }

/** A failed lookup cannot establish that an action disappeared or was repaired. */
export function resolveQualityFocusResponse(
  signal: Response<AgentQualitySignal> | null,
  overview: Response<AgentQualityOverview> | null,
  agentId: string,
): { state: "ready"; payload: QualityFocusPayload } | { state: "gone" | "unavailable"; payload: null } {
  if (!signal?.success || !signal.data) return { state: signal?.httpStatus === 404 ? "gone" : "unavailable", payload: null };
  if (signal.data.agent.id !== agentId) return { state: "unavailable", payload: null };
  return { state: "ready", payload: {
    signal: signal.data,
    overview: overview?.success && overview.data?.agent.id === agentId ? overview.data : null,
  } };
}
