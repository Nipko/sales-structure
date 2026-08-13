"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentQualityAttentionSummary } from "@parallext/shared";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import { QUALITY_HEALTH_CACHE_MS, shouldBootstrapQualitySummary } from "@/lib/quality-health";
import { QUALITY_HEALTH_REFRESH_EVENT } from "@/lib/quality-health-events";

interface CachedSummary {
  data: AgentQualityAttentionSummary;
  fetchedAt: number;
}

interface TenantSummary {
  tenantId: string;
  data: AgentQualityAttentionSummary;
}

interface QualityHealthContextValue {
  summary: AgentQualityAttentionSummary | null;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
  snoozeSignal: (signalId: string, durationHours?: number) => Promise<boolean>;
}

const summaryCache = new Map<string, CachedSummary>();
const bootstrapAttempts = new Map<string, number>();

const QualityHealthContext = createContext<QualityHealthContextValue | null>(null);

export function QualityHealthProvider({ children }: { children: ReactNode }) {
  const { activeTenantId } = useTenant();
  const { role, isSuperAdmin, impersonating } = useRole();
  const eligible = role === "tenant_admin"
    || role === "tenant_supervisor"
    || (isSuperAdmin && impersonating);
  const [tenantSummary, setTenantSummary] = useState<TenantSummary | null>(null);
  const summary = tenantSummary?.tenantId === activeTenantId ? tenantSummary.data : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestRef = useRef(0);
  const reconcileRef = useRef<() => Promise<boolean>>(async () => false);

  const load = useCallback(async (force = false) => {
    if (!eligible || !activeTenantId) {
      requestRef.current += 1;
      setTenantSummary(null);
      setLoading(false);
      setError(false);
      return;
    }

    const cached = summaryCache.get(activeTenantId);
    if (!force && cached && Date.now() - cached.fetchedAt < QUALITY_HEALTH_CACHE_MS) {
      setTenantSummary({ tenantId: activeTenantId, data: cached.data });
      setLoading(false);
      setError(false);
      return;
    }

    const requestId = ++requestRef.current;
    setLoading(!cached);
    setError(false);
    if (cached) setTenantSummary({ tenantId: activeTenantId, data: cached.data });
    else setTenantSummary(null);

    try {
      const response = await api.getAgentQualityAttentionSummary(activeTenantId);
      if (requestId !== requestRef.current) return;
      if (!response?.success || !response.data) throw new Error("quality_attention_unavailable");
      summaryCache.set(activeTenantId, { data: response.data, fetchedAt: Date.now() });
      setTenantSummary({ tenantId: activeTenantId, data: response.data });
      // Existing tenants predate durable snapshots. Bootstrap once per app
      // session when the server proves that at least one current agent has not
      // yet been evaluated; the server coalesces tabs with its tenant lock.
      const lastBootstrapAttempt = bootstrapAttempts.get(activeTenantId) ?? 0;
      if (shouldBootstrapQualitySummary(response.data, lastBootstrapAttempt)) {
        const bootstrapTenantId = activeTenantId;
        bootstrapAttempts.set(bootstrapTenantId, Date.now());
        void reconcileRef.current().then((success) => {
          if (!success) bootstrapAttempts.delete(bootstrapTenantId);
        });
      }
    } catch {
      if (requestId === requestRef.current) setError(true);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeTenantId, eligible]);

  const reconcile = useCallback(async (): Promise<boolean> => {
    if (!eligible || !activeTenantId) return false;
    const requestId = ++requestRef.current;
    setLoading(!summaryCache.has(activeTenantId));
    setError(false);
    try {
      const response = await api.reconcileAgentQualityAttention(activeTenantId);
      if (requestId !== requestRef.current) return false;
      if (!response?.success || !response.data) throw new Error("quality_reconcile_unavailable");
      summaryCache.set(activeTenantId, { data: response.data, fetchedAt: Date.now() });
      setTenantSummary({ tenantId: activeTenantId, data: response.data });
      return true;
    } catch {
      if (requestId === requestRef.current) setError(true);
      return false;
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeTenantId, eligible]);
  reconcileRef.current = reconcile;

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const refresh = () => { void reconcile(); };
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible" || !activeTenantId) return;
      const cached = summaryCache.get(activeTenantId);
      if (!cached || Date.now() - cached.fetchedAt >= QUALITY_HEALTH_CACHE_MS) void load(true);
    };
    window.addEventListener(QUALITY_HEALTH_REFRESH_EVENT, refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, QUALITY_HEALTH_CACHE_MS);
    return () => {
      window.removeEventListener(QUALITY_HEALTH_REFRESH_EVENT, refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(poll);
    };
  }, [activeTenantId, load, reconcile]);

  const refresh = useCallback(async () => {
    await reconcile();
  }, [reconcile]);

  const snoozeSignal = useCallback(async (signalId: string, durationHours = 24) => {
    if (!activeTenantId || !signalId) return false;
    const previous = summary;
    if (summary?.topAction?.signalId === signalId) {
      setTenantSummary({ tenantId: activeTenantId, data: { ...summary, topAction: undefined } });
    }
    try {
      const response = await api.snoozeAgentQualitySignal(activeTenantId, signalId, { durationHours });
      if (!response?.success) throw new Error("quality_snooze_failed");
      summaryCache.delete(activeTenantId);
      await load(true);
      return true;
    } catch {
      setTenantSummary(previous ? { tenantId: activeTenantId, data: previous } : null);
      setError(true);
      return false;
    }
  }, [activeTenantId, load, summary]);

  const value = useMemo<QualityHealthContextValue>(() => ({
    summary,
    loading,
    error,
    refresh,
    snoozeSignal,
  }), [error, loading, refresh, snoozeSignal, summary]);

  return <QualityHealthContext.Provider value={value}>{children}</QualityHealthContext.Provider>;
}

export function useQualityHealth(): QualityHealthContextValue {
  const context = useContext(QualityHealthContext);
  if (!context) throw new Error("useQualityHealth must be used inside QualityHealthProvider");
  return context;
}
