"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
    Role,
    isSuperAdmin,
    isTenantAdmin,
    isAdmin,
    isSupervisor,
    isAgentOnly,
    canAccessPath,
    getCapabilities,
    Capabilities,
} from "@/lib/roles";

interface UseRoleReturn extends Capabilities {
    role: Role | null;
    impersonating: boolean;
    isSuperAdmin: boolean;
    isTenantAdmin: boolean;
    isAdmin: boolean;
    isSupervisor: boolean;
    isAgentOnly: boolean;
    canAccess: (path: string) => boolean;
}

/**
 * Single source of truth for role checks in components. Reads role from
 * AuthContext + impersonation state from localStorage. The impersonation
 * flag is reactive — listening to storage events so when the user clicks
 * "Exit impersonation" in the banner the rest of the UI updates without
 * a manual refresh.
 */
export function useRole(): UseRoleReturn {
    const { user } = useAuth();
    const role = (user?.role || null) as Role | null;

    const [impersonating, setImpersonating] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        try {
            return Boolean(localStorage.getItem("impersonation"));
        } catch {
            return false;
        }
    });

    useEffect(() => {
        const sync = () => {
            try {
                setImpersonating(Boolean(localStorage.getItem("impersonation")));
            } catch {
                setImpersonating(false);
            }
        };
        sync();
        // storage event fires across tabs; we also poll once on focus to catch
        // same-tab changes that don't dispatch storage events.
        window.addEventListener("storage", sync);
        window.addEventListener("focus", sync);
        return () => {
            window.removeEventListener("storage", sync);
            window.removeEventListener("focus", sync);
        };
    }, []);

    const caps = getCapabilities(role, impersonating);

    return {
        role,
        impersonating,
        isSuperAdmin: isSuperAdmin(role),
        isTenantAdmin: isTenantAdmin(role),
        isAdmin: isAdmin(role),
        isSupervisor: isSupervisor(role),
        isAgentOnly: isAgentOnly(role),
        canAccess: (path: string) => canAccessPath(path, role, impersonating),
        ...caps,
    };
}
