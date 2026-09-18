"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { reviewModeFromResponse, type AgentReviewModeReading } from "@/lib/agent-review-mode";

/**
 * Reads the tenant's change mode when — and only when — `enabled` says a
 * surface is about to describe a save.
 *
 * The endpoint is an admin's (`@Roles('tenant_admin')`), so callers enable it
 * for roles that can act on the answer; everyone else keeps `unknown`, whose
 * copy is true in both modes. Nothing is cached across mounts: the mode can be
 * switched on the agents page, and a stale "immediate" would repeat the exact
 * lie this exists to remove.
 */
export function useAgentReviewMode(tenantId: string | null | undefined, enabled: boolean): AgentReviewModeReading {
  const [reading, setReading] = useState<{ tenantId: string; mode: AgentReviewModeReading } | null>(null);
  useEffect(() => {
    if (!enabled || !tenantId) return;
    let active = true;
    Promise.resolve()
      .then(() => api.getAgentReviewMode(tenantId))
      .then((response) => { if (active) setReading({ tenantId, mode: reviewModeFromResponse(response) }); })
      .catch(() => { if (active) setReading({ tenantId, mode: "unknown" }); });
    return () => { active = false; };
  }, [tenantId, enabled]);
  // A reading for another tenant says nothing about this one.
  return enabled && tenantId && reading?.tenantId === tenantId ? reading.mode : "unknown";
}
