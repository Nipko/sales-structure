"use client";

import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Context that provides the tenant whose data the UI is operating on.
 * For tenant_admin / tenant_agent it is their assigned tenantId, and for a
 * super_admin it is only ever set while impersonating (the impersonation token
 * carries the tenant role, so the branch below resolves it).
 *
 * A super_admin in platform mode has NO tenant here on purpose: the console
 * works on all-tenants listings, a single tenant is reviewed at
 * /admin/tenants/[id], and acting as one requires impersonation.
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

            // Super admin in platform mode: NO implicit tenant. Auto-selecting one
            // meant pages reached by URL (procedures, api-keys, integrations…) read
            // and wrote against whichever tenant happened to be first in the list.
            // Reviewing a tenant goes through /admin/tenants/[id], and acting as one
            // goes through impersonation — which sets user.tenantId via the branch above.
            localStorage.removeItem("activeTenantId");
            setTenants([]);
            setActiveTenantId(null);
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
