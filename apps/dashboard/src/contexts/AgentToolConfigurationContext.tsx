"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentToolConfigurationSummary } from '@parallext/shared';
import { useAuth } from './AuthContext';
import { useTenant } from './TenantContext';
import { api } from '@/lib/api';
import { AGENT_CONFIGURATION_APPLIED_EVENT, QUALITY_HEALTH_REFRESH_EVENT } from '@/lib/quality-health-events';

interface ToolConfigurationContext {
  summary: AgentToolConfigurationSummary | null;
  loading: boolean;
  refresh: () => Promise<void>;
}
const Context = createContext<ToolConfigurationContext>({ summary: null, loading: false, refresh: async () => {} });

export function AgentToolConfigurationProvider({ children }: { children: ReactNode }) {
  const { activeTenantId } = useTenant();
  const { user } = useAuth();
  // Include authenticated identity: even a fast impersonation change must not
  // reuse another session's answer while TenantContext is catching up.
  const tenantId = user && (user.role === 'super_admin' || user.tenantId === activeTenantId) ? activeTenantId : null;
  const scope = tenantId ? `${user?.id}:${user?.role}:${tenantId}` : null;
  const [snapshot, setSnapshot] = useState<{ scope: string; data: AgentToolConfigurationSummary } | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const lastAttempt = useRef(0);
  const refresh = useCallback(async () => {
    const revision = ++request.current;
    setSnapshot(null);
    if (!tenantId || !scope) { setLoading(false); return; }
    setLoading(true);
    lastAttempt.current = Date.now();
    try {
      const response = await api.getAgentToolConfigurationSummary(tenantId);
      if (revision !== request.current) return;
      if (response.success && response.data?.source === 'operational') setSnapshot({ scope, data: response.data });
    } catch { /* Unknown is not disabled. Manual work remains independent. */ }
    finally { if (revision === request.current) setLoading(false); }
  }, [tenantId, scope]);

  useEffect(() => {
    const activeRequests = request; // Mutable request sequence, not a mounted DOM node.
    void refresh();
    const reload = () => { void refresh(); };
    const applied = (event: Event) => {
      if ((event as CustomEvent<{ tenantId?: string }>).detail?.tenantId === tenantId) reload();
    };
    const revalidate = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastAttempt.current >= 60_000) reload();
    };
    window.addEventListener(AGENT_CONFIGURATION_APPLIED_EVENT, applied);
    window.addEventListener(QUALITY_HEALTH_REFRESH_EVENT, reload);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    const interval = window.setInterval(revalidate, 60_000);
    return () => {
      activeRequests.current++;
      window.clearInterval(interval);
      window.removeEventListener(AGENT_CONFIGURATION_APPLIED_EVENT, applied);
      window.removeEventListener(QUALITY_HEALTH_REFRESH_EVENT, reload);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [refresh, tenantId]);

  return <Context.Provider value={{ summary: snapshot?.scope === scope ? snapshot?.data ?? null : null, loading, refresh }}>{children}</Context.Provider>;
}

export function useAgentToolConfiguration() { return useContext(Context); }
