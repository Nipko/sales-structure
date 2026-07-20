"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import SessionTimeoutModal from "@/components/SessionTimeoutModal";
import SessionConflictModal from "@/components/SessionConflictModal";

// ============================================
// Constants
// ============================================

const IDLE_TIMEOUT_MS = 60 * 60 * 1000;  // 60 minutes
const WARNING_BEFORE_MS = 2 * 60 * 1000; // 2 minutes before timeout
const WARNING_SECONDS = 120;              // 2 min countdown
const PROACTIVE_REFRESH_MS = 10 * 60 * 1000; // Refresh at 10 min (access token is 15 min)
const ACTIVITY_PING_MS = 5 * 60 * 1000; // 5 min — keeps server-side session alive (6 min TTL)

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
    requires2FA?: boolean;
    twoFAToken?: string;
    twoFactorMethod?: string;
}

interface LoginResult {
    success: boolean;
    error?: string;
    redirect?: string;
    requires2FA?: boolean;
    twoFAToken?: string;
    twoFactorMethod?: string;
}

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    verticalConfig: any | null;
    login: (email: string, password: string, rememberMe?: boolean) => Promise<LoginResult>;
    googleLogin: (idToken: string, rememberMe?: boolean) => Promise<GoogleLoginResult>;
    complete2FALogin: (twoFAToken: string, code: string, method: 'totp' | 'email' | 'backup' | 'sms', rememberMe?: boolean, trustDevice?: boolean, deviceInfo?: any) => Promise<LoginResult & { deviceTrustToken?: string }>;
    send2FAEmailFallback: (twoFAToken: string) => Promise<boolean>;
    send2FASmsFallback: (twoFAToken: string) => Promise<boolean>;
    logout: () => void;
    hasRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";

// Pages that don't need session management
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/verify-email", "/setup-password", "/onboarding", "/book", "/kb"];

// ============================================
// Provider
// ============================================

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showWarning, setShowWarning] = useState(false);
    const [showSessionConflict, setShowSessionConflict] = useState(false);
    const [verticalConfig, setVerticalConfig] = useState<any | null>(null);
    const router = useRouter();
    const pathname = usePathname();
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activityPingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const bcRef = useRef<BroadcastChannel | null>(null);
    const pendingLoginRef = useRef<{ type: 'email'; email: string; password: string; rememberMe: boolean } | { type: 'google'; idToken: string; rememberMe: boolean } | null>(null);

    const isPublicPage = PUBLIC_PATHS.some((p) => pathname?.startsWith(p));
    const isAuthenticated = !!user;

    // ── BroadcastChannel for logout sync ──
    useEffect(() => {
        try {
            const bc = new BroadcastChannel("parallly-session");
            bc.onmessage = (evt) => {
                if (evt.data?.type === "logout") {
                    setUser(null);
                    setVerticalConfig(null);
                    localStorage.removeItem("accessToken");
                    localStorage.removeItem("refreshToken");
                    localStorage.removeItem("user");
                    localStorage.removeItem("verticalConfig");
                    localStorage.removeItem("impersonation");
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
                const parsed = JSON.parse(savedUser);
                setUser(parsed);

                // Restore cached vertical config
                const cachedVertical = localStorage.getItem("verticalConfig");
                if (cachedVertical) {
                    try { setVerticalConfig(JSON.parse(cachedVertical)); } catch { /* noop */ }
                }

                // Refresh vertical config from API
                if (parsed.tenantId) {
                    fetchVerticalConfig(parsed.tenantId);
                }
            } catch {
                localStorage.removeItem("accessToken");
                localStorage.removeItem("refreshToken");
                localStorage.removeItem("user");
                localStorage.removeItem("verticalConfig");
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

    // ── Activity ping — keeps server-side session alive ──
    useEffect(() => {
        if (!isAuthenticated || isPublicPage) return;

        const sendPing = async () => {
            const token = localStorage.getItem("accessToken");
            if (!token) return;
            try {
                const res = await fetch(`${API_URL}/auth/activity-ping`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                });
                if (res.status === 401) {
                    performLogout(true, true);
                }
            } catch { /* noop */ }
        };

        sendPing();
        activityPingRef.current = setInterval(sendPing, ACTIVITY_PING_MS);

        return () => {
            if (activityPingRef.current) clearInterval(activityPingRef.current);
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

    // ── Fetch vertical config ──
    const fetchVerticalConfig = useCallback(async (tenantId: string) => {
        try {
            const token = localStorage.getItem("accessToken");
            if (!token) return;
            const res = await fetch(`${API_URL}/verticals/${tenantId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.data) {
                    setVerticalConfig(data.data);
                    localStorage.setItem("verticalConfig", JSON.stringify(data.data));
                }
            }
        } catch {
            // Silently fail — vertical config is non-critical
        }
    }, []);

    // ── Auth methods ──

    const getRedirectPath = useCallback((userData: User): string => {
        if (userData.role === "super_admin" || userData.tenantId) return "/admin";
        if (!userData.emailVerified) return "/verify-email";
        if (!userData.onboardingCompleted) return "/onboarding";
        return "/admin";
    }, []);

    const login = useCallback(async (email: string, password: string, rememberMe = false, force = false): Promise<LoginResult> => {
        try {
            const deviceTrustToken = localStorage.getItem("deviceTrustToken") || undefined;
            const res = await fetch(`${API_URL}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password, rememberMe, force, deviceTrustToken }),
            });

            if (res.status === 409) {
                pendingLoginRef.current = { type: 'email', email, password, rememberMe };
                setShowSessionConflict(true);
                return { success: false, error: "session_conflict" };
            }

            const data = await res.json();

            if (!res.ok || !data.success) {
                return { success: false, error: data.message || "Invalid credentials" };
            }

            if (data.data.requires2FA) {
                return {
                    success: false,
                    requires2FA: true,
                    twoFAToken: data.data.twoFAToken,
                    twoFactorMethod: data.data.twoFactorMethod,
                };
            }

            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("refreshToken", data.data.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

            setUser(data.data.user);

            if (data.data.user.tenantId) {
                fetchVerticalConfig(data.data.user.tenantId);
            }

            return { success: true, redirect: getRedirectPath(data.data.user) };
        } catch {
            return { success: false, error: "Connection error con el servidor" };
        }
    }, [getRedirectPath, fetchVerticalConfig]);

    const googleLogin = useCallback(async (idToken: string, rememberMe = false, force = false): Promise<GoogleLoginResult> => {
        try {
            const deviceTrustToken = localStorage.getItem("deviceTrustToken") || undefined;
            const res = await fetch(`${API_URL}/auth/google`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idToken, rememberMe, force, deviceTrustToken }),
            });

            if (res.status === 409) {
                pendingLoginRef.current = { type: 'google', idToken, rememberMe };
                setShowSessionConflict(true);
                return { success: false, error: "session_conflict" };
            }

            const data = await res.json();

            if (!res.ok || !data.success) {
                return { success: false, error: data.message || "Error logging in with Google" };
            }

            if (data.data.requires2FA) {
                return {
                    success: false,
                    requires2FA: true,
                    twoFAToken: data.data.twoFAToken,
                    twoFactorMethod: data.data.twoFactorMethod,
                };
            }

            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("refreshToken", data.data.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

            setUser(data.data.user);

            if (data.data.user.tenantId) {
                fetchVerticalConfig(data.data.user.tenantId);
            }

            return { success: true, redirect: getRedirectPath(data.data.user) };
        } catch {
            return { success: false, error: "Connection error con el servidor" };
        }
    }, [getRedirectPath, fetchVerticalConfig]);

    const complete2FALogin = useCallback(async (twoFAToken: string, code: string, method: 'totp' | 'email' | 'backup' | 'sms', rememberMe = false, trustDevice = false, deviceInfo?: any): Promise<LoginResult & { deviceTrustToken?: string }> => {
        try {
            const res = await fetch(`${API_URL}/auth/2fa/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ twoFAToken, code, method, rememberMe, trustDevice, deviceInfo }),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                return { success: false, error: data.message || "Invalid code" };
            }

            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("refreshToken", data.data.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

            if (data.data.deviceTrustToken) {
                localStorage.setItem("deviceTrustToken", data.data.deviceTrustToken);
            }

            setUser(data.data.user);

            if (data.data.user.tenantId) {
                fetchVerticalConfig(data.data.user.tenantId);
            }

            return { success: true, redirect: getRedirectPath(data.data.user), deviceTrustToken: data.data.deviceTrustToken };
        } catch {
            return { success: false, error: "Connection error" };
        }
    }, [getRedirectPath, fetchVerticalConfig]);

    const send2FAEmailFallback = useCallback(async (twoFAToken: string): Promise<boolean> => {
        try {
            const res = await fetch(`${API_URL}/auth/2fa/send-email`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ twoFAToken }),
            });
            return res.ok;
        } catch {
            return false;
        }
    }, []);

    const send2FASmsFallback = useCallback(async (twoFAToken: string): Promise<boolean> => {
        try {
            const res = await fetch(`${API_URL}/auth/2fa/send-sms`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ twoFAToken }),
            });
            return res.ok;
        } catch {
            return false;
        }
    }, []);

    const performLogout = useCallback((expired = false, kicked = false) => {
        const refreshToken = localStorage.getItem("refreshToken");
        if (refreshToken) {
            fetch(`${API_URL}/auth/logout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refreshToken }),
            }).catch(() => { /* best effort */ });
        }

        try {
            bcRef.current?.postMessage({ type: "logout" });
        } catch { /* noop */ }

        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        localStorage.removeItem("user");
        localStorage.removeItem("verticalConfig");
        localStorage.removeItem("impersonation");
        setUser(null);
        setVerticalConfig(null);
        if (kicked) {
            router.push("/login?kicked=1");
        } else if (expired) {
            router.push("/login?expired=1");
        } else {
            router.push("/login");
        }
    }, [router]);

    const logout = useCallback(() => performLogout(false), [performLogout]);

    const handleForceLogin = useCallback(async () => {
        setShowSessionConflict(false);
        const pending = pendingLoginRef.current;
        if (!pending) return;
        pendingLoginRef.current = null;

        let result: LoginResult | GoogleLoginResult;
        if (pending.type === 'email') {
            result = await login(pending.email, pending.password, pending.rememberMe, true);
        } else {
            result = await googleLogin(pending.idToken, pending.rememberMe, true);
        }
        if (result.success && result.redirect) {
            router.push(result.redirect);
        }
    }, [login, googleLogin, router]);

    const handleCancelConflict = useCallback(() => {
        setShowSessionConflict(false);
        pendingLoginRef.current = null;
    }, []);

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
                verticalConfig,
                login,
                googleLogin,
                complete2FALogin,
                send2FAEmailFallback,
                send2FASmsFallback,
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
            <SessionConflictModal
                open={showSessionConflict}
                onForceLogin={handleForceLogin}
                onCancel={handleCancelConflict}
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
