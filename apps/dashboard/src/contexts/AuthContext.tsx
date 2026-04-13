"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { useRouter } from "next/navigation";

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
    login: (email: string, password: string) => Promise<LoginResult>;
    googleLogin: (idToken: string) => Promise<GoogleLoginResult>;
    logout: () => void;
    hasRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";

// ============================================
// Provider
// ============================================

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();

    // Check for existing session on mount
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

    const getRedirectPath = useCallback((userData: User): string => {
        // super_admin and users with a tenant skip onboarding entirely
        if (userData.role === "super_admin" || userData.tenantId) {
            return "/admin";
        }
        // New Google users without password
        if (!userData.hasPassword) return "/setup-password";
        // Users who haven't verified email
        if (!userData.emailVerified) return "/verify-email";
        // Users without a company/tenant
        if (!userData.onboardingCompleted) return "/onboarding";
        return "/admin";
    }, []);

    const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
        try {
            const res = await fetch(`${API_URL}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                return { success: false, error: data.message || "Credenciales inválidas" };
            }

            // Store tokens and user
            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("refreshToken", data.data.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

            setUser(data.data.user);
            return { success: true, redirect: getRedirectPath(data.data.user) };
        } catch (err) {
            return { success: false, error: "Error de conexión con el servidor" };
        }
    }, [getRedirectPath]);

    const googleLogin = useCallback(async (idToken: string): Promise<GoogleLoginResult> => {
        try {
            const res = await fetch(`${API_URL}/auth/google`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idToken }),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                return { success: false, error: data.message || "Error al iniciar sesión con Google" };
            }

            localStorage.setItem("accessToken", data.data.accessToken);
            localStorage.setItem("refreshToken", data.data.refreshToken);
            localStorage.setItem("user", JSON.stringify(data.data.user));

            setUser(data.data.user);
            return { success: true, redirect: getRedirectPath(data.data.user) };
        } catch (err) {
            return { success: false, error: "Error de conexión con el servidor" };
        }
    }, [getRedirectPath]);

    const logout = useCallback(() => {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        localStorage.removeItem("user");
        setUser(null);
        router.push("/login");
    }, [router]);

    const hasRole = useCallback((...roles: string[]) => {
        if (!user) return false;
        return roles.includes(user.role);
    }, [user]);

    return (
        <AuthContext.Provider
            value={{
                user,
                isLoading,
                isAuthenticated: !!user,
                login,
                googleLogin,
                logout,
                hasRole,
            }}
        >
            {children}
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
