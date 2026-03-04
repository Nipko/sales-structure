"use client";

import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Context that provides the currently selected tenant for super_admin users.
 * For tenant_admin / tenant_agent, it uses their assigned tenantId.
 * For super_admin, it allows selecting any tenant from a dropdown.
 */

interface TenantContextType {
    activeTenantId: string | null;
    activeTenantName: string | null;
    tenants: { id: string; name: string }[];
    setActiveTenant: (id: string) => void;
    isLoading: boolean;
}

const TenantContext = createContext<TenantContextType>({
    activeTenantId: null,
    activeTenantName: null,
    tenants: [],
    setActiveTenant: () => { },
    isLoading: true,
});

export function TenantProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
    const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Load tenant list for super_admin
    useEffect(() => {
        async function load() {
            if (!user) { setIsLoading(false); return; }

            // Non-super_admin: use their assigned tenant
            if (user.role !== "super_admin" && user.tenantId) {
                setActiveTenantId(user.tenantId);
                setTenants([{ id: user.tenantId, name: user.tenantName || "Mi Tenant" }]);
                setIsLoading(false);
                return;
            }

            // Super admin: load all tenants
            const result = await api.getTenants();
            if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                const mapped = result.data.map((t: any) => ({ id: t.id, name: t.name }));
                setTenants(mapped);
                // Auto-select first tenant or saved preference
                const saved = localStorage.getItem("activeTenantId");
                const validSaved = saved && mapped.some((t: any) => t.id === saved);
                setActiveTenantId(validSaved ? saved : mapped[0].id);
            }
            setIsLoading(false);
        }
        load();
    }, [user]);

    const setActiveTenant = (id: string) => {
        setActiveTenantId(id);
        localStorage.setItem("activeTenantId", id);
    };

    const activeTenantName = tenants.find(t => t.id === activeTenantId)?.name || null;

    return (
        <TenantContext.Provider value={{ activeTenantId, activeTenantName, tenants, setActiveTenant, isLoading }}>
            {children}
        </TenantContext.Provider>
    );
}

export function useTenant() {
    return useContext(TenantContext);
}

/**
 * Tenant selector dropdown — only visible for super_admin.
 */
export function TenantSelector() {
    const { user } = useAuth();
    const { tenants, activeTenantId, activeTenantName, setActiveTenant } = useTenant();

    if (user?.role !== "super_admin" || tenants.length <= 1) return null;

    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 12px", borderRadius: 10,
            background: "rgba(108, 92, 231, 0.08)",
            border: "1px solid rgba(108, 92, 231, 0.2)",
        }}>
            <span style={{ fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                Tenant:
            </span>
            <select
                value={activeTenantId || ""}
                onChange={e => setActiveTenant(e.target.value)}
                style={{
                    background: "transparent", border: "none", color: "var(--accent)",
                    fontSize: 13, fontWeight: 600, cursor: "pointer", outline: "none",
                    maxWidth: 200,
                }}
            >
                {tenants.map(t => (
                    <option key={t.id} value={t.id} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}>
                        {t.name}
                    </option>
                ))}
            </select>
        </div>
    );
}
