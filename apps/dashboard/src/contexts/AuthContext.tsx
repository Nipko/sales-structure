"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import SessionTimeoutModal from "@/components/SessionTimeoutModal";

// ============================================
// Constants
// ============================================

const IDLE_TIMEOUT_MS = 60 * 60 * 1000;  // 60 minutes
const WARNING_BEFORE_MS = 2 * 60 * 1000; // 2 minutes before timeout
const WARNING_SECONDS = 120;              // 2 min countdown
const PROACTIVE_REFRESH_MS = 12 * 60 * 1000; // Refresh at ~12 min (access token is 15 min)

// ============================================
// Types
// ============================================

interface User {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    tenantId?: string;
    tenantName?: string;
    picture?: string;
    hasPassword?: boolean;
    emailVerified?: boolean;
    onboardingCompleted?: boolean;
}

interface GoogleLoginResult {
    success: boolean;
    error?: string;
    redirect?: string;
}

interface LoginResult {
    success: boolean;
    error?: string;
    redirect?: string;
}

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: (email: string, password: string, rememberMe?: boolean) => Promise<LoginResult>;
    googleLogin: (idToken: string, rememberMe?: boolean) => Promise<GoogleLoginResult>;
    logout: () => void;
    hasRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";

// Pages that don't need session management
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/verify-email", "/setup-password", "/onboarding"];

// ============================================
// Provider
// ============================================

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showWarning, setShowWarning] = useState(false);
    const router = useRouter();
    const pathname = usePathname();
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const bcRef = useRef<BroadcastChannel | null>(null);

    const isPublicPage = PUBLIC_PATHS.some((p) => pathname?.startsWith(p));
    const isAuthenticated = !!user;

    // ── BroadcastChannel for logout sync ──
    useEffect(() => {
        try {
            const bc = new BroadcastChannel("parallly-session");
            bc.onmessage = (evt) => {
                if (evt.data?.type === "logout") {
                    setUser(null);
                    localStorage.removeItem("accessToken");
                    localStorage.removeItem("refreshToken");
                    localStorage.removeItem("user");
                    router.push("/login?expired=1");
                }
            };
            bcRef.current = bc;
            return () => { try { bc.close(); } catch { /* noop */ } };
        } catch {
            return;
        }
    }, [router]);

    // ── Check for existing session on mount ──
    useEffect(() => {
        const token = localStorage.getItem("accessToken");
        const savedUser = localStorage.getItem("user");

        if (token && savedUser) {
            try {
                setUser(JSON.parse(savedUser));
            } catch {
                localStorage.clear();
            }
        }
        setIsLoading(false);
    }, []);

    // ── Proactive token refresh ──
    useEffect(() => {
        if (!isAuthenticated || isPublicPage) return;

        const scheduleRefresh = () => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = setTimeout(async () => {
                const refreshToken = localStorage.getItem("refreshToken");
                if (!refreshToken) return;

                try {
                    const res = await fetch(`${API_URL}/auth/refresh`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ refreshToken }),
                    });

                    if (res.ok) {
                        const data = await res.json();
                        if (data.success) {
                            localStorage.setItem("accessToken", data.data.accessToken);
                            if (data.data.refreshToken) {
                                localStorage.setItem("refreshToken", data.data.refreshToken);
                            }
                            scheduleRefresh(); // Schedule next refresh
                        }
                    }
                } catch {
                    // Silently fail — the 401 interceptor in api.ts will handle it
                }
            }, PROACTIVE_REFRESH_MS);
        };

        scheduleRefresh();

        return () => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        };
    }, [isAuthenticated, isPublicPage]);

    // ── Idle timer ──
    const handleWarning = useCallback(() => {
        setShowWarning(true);
    }, []);

    const handleTimeout = useCallback(() => {
        setShowWarning(false);
        performLogout(true);
    }, []);

    const { resetActivity } = useIdleTimer({
        timeout: IDLE_TIMEOUT_MS,
        warningBefore: WARNING_BEFORE_MS,
        onWarning: handleWarning,
        onTimeout: handleTimeout,
        enabled: isAuthenticated && !isPublicPage,
    });

    const handleStayLoggedIn = useCallback(async () => {
        setShowWarning(false);
        resetActivity();

        // Also refresh the token proactively
        const refreshToken = localStorage.getItem("refreshToken");
        if (!refreshToken) return;

        try {
            const res = await fetch(`${API_URL}/auth/refresh`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refreshToken }),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    localStorage.setItem("accessToken", data.data.accessToken);
                    if (data.data.refreshToken) {
                        localStorage.setItem("refreshToken", data.data.refreshToken);
                    }
                }
            }
        } catch { /* noop */ }
    }, [resetActivity]);

    // ── Auth methods ──

    const getRedirectPath = useCallback((userData: User): string => {
        if (userData.role === "super_admin" || userData.tenantId) return "/admin";
        if (!userData.emailVerified) return "/verify-email";
        if (!userData.onboardingCompleted) return "/onboarding";
        return "/admin";
    }, []);

    const login = useCallback(async (email: string, password: string, rememberMe = false): Promise<LoginResult> => {
        try {
            const res = await fetch(`${API_URL}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password, rememberMe }),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                return { success: false, error: data.message || "Invalid credentials" };
            }

            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("refreshToken", data.data.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

            setUser(data.data.user);
            return { success: true, redirect: getRedirectPath(data.data.user) };
        } catch {
            return { success: false, error: "Connection error con el servidor" };
        }
    }, [getRedirectPath]);

    const googleLogin = useCallback(async (idToken: string, rememberMe = false): Promise<GoogleLoginResult> => {
        try {
            const res = await fetch(`${API_URL}/auth/google`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idToken, rememberMe }),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                return { success: false, error: data.message || "Error logging in with Google" };
            }

            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("refreshToken", data.data.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

            setUser(data.data.user);
            return { success: true, redirect: getRedirectPath(data.data.user) };
        } catch {
            return { success: false, error: "Connection error con el servidor" };
        }
    }, [getRedirectPath]);

    const performLogout = useCallback((expired = false) => {
        // Call logout API to revoke refresh token
        const refreshToken = localStorage.getItem("refreshToken");
        if (refreshToken) {
            fetch(`${API_URL}/auth/logout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refreshToken }),
            }).catch(() => { /* best effort */ });
        }

        // Broadcast logout to all tabs
        try {
            bcRef.current?.postMessage({ type: "logout" });
        } catch { /* noop */ }

        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        localStorage.removeItem("user");
        setUser(null);
        router.push(expired ? "/login?expired=1" : "/login");
    }, [router]);

    const logout = useCallback(() => performLogout(false), [performLogout]);

    const hasRole = useCallback((...roles: string[]) => {
        if (!user) return false;
        return roles.includes(user.role);
    }, [user]);

    return (
        <AuthContext.Provider
            value={{
                user,
                isLoading,
                isAuthenticated,
                login,
                googleLogin,
                logout,
                hasRole,
            }}
        >
            {children}
            <SessionTimeoutModal
                open={showWarning}
                secondsLeft={WARNING_SECONDS}
                onStayLoggedIn={handleStayLoggedIn}
                onLogout={() => performLogout(true)}
            />
        </AuthContext.Provider>
    );
}

// ============================================
// Hook
// ============================================

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used within AuthProvider");
    return context;
}
