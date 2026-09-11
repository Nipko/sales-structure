import {
  AGENT_CONFIG_TOOL_FAMILIES,
  TOOL_GROUP_PLAN_FEATURE,
  VERTICAL_CAPABILITY_MANIFEST,
  VERTICAL_TOOL_GROUPS,
  isVerticalManifestIndustry,
  resolveVerticalCapabilityManifest,
} from "@parallext/shared";
import type { DashboardVerticalConfigLike } from "./vertical-dashboard-resolver";

export type AgentToolAvailabilityReason = "profile_unknown" | "not_in_subtype" | "plan_unknown" | "plan_missing_feature";
export interface AgentToolAvailability {
  visible: boolean;
  canEnable: boolean;
  reason: AgentToolAvailabilityReason | null;
}

/** The editor uses the same tenant subtype ceiling and plan keys as draft admission. */
export function resolveAgentToolAvailability(
  vertical: DashboardVerticalConfigLike | null | undefined,
  tools: Record<string, { enabled?: boolean } | undefined>,
  planFeatures: Record<string, unknown> | null | undefined,
): Record<string, AgentToolAvailability> {
  const industry = typeof vertical?.industry === "string" ? vertical.industry : "";
  const rawSubtype = vertical?.subType ?? vertical?.subtype;
  const subtype = typeof rawSubtype === "string" && rawSubtype ? rawSubtype : null;
  let profileGroups: Set<string> | null = null;
  if (isVerticalManifestIndustry(industry)
    && (subtype || VERTICAL_CAPABILITY_MANIFEST[industry].subtypes.length === 0)) {
    try { profileGroups = new Set(resolveVerticalCapabilityManifest(industry, subtype).toolGroups); }
    catch { /* Incomplete or unknown tenant profiles do not authorize tools. */ }
  }
  const scoped = new Set<string>(VERTICAL_TOOL_GROUPS);
  return Object.fromEntries(AGENT_CONFIG_TOOL_FAMILIES.map((family) => {
    const enabled = tools[family]?.enabled === true;
    const applicable = !scoped.has(family) || profileGroups?.has(family) === true;
    let reason: AgentToolAvailabilityReason | null = scoped.has(family) && !profileGroups
      ? "profile_unknown"
      : !applicable ? "not_in_subtype" : null;
    const feature = TOOL_GROUP_PLAN_FEATURE[family];
    if (!reason && feature && planFeatures?.[feature] !== true) {
      reason = planFeatures?.[feature] == null ? "plan_unknown" : "plan_missing_feature";
    }
    return [family, { visible: applicable || enabled, canEnable: reason === null, reason }];
  }));
}
