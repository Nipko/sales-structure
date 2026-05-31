import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { api, tokens, AuthUser } from '../lib/api';
import { disconnectSocket } from '../lib/socket';

interface AuthState {
    user: AuthUser | null;
    tenantId: string | null;
    verticalConfig: any | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({} as AuthState);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [verticalConfig, setVerticalConfig] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);

    // Load the tenant's vertical config (terminology) — best-effort.
    const loadVertical = useCallback(async (tenantId?: string) => {
        if (!tenantId) return;
        try {
            const res: any = await api.getVerticalConfig(tenantId);
            if (res?.success && res.data) setVerticalConfig(res.data);
        } catch { /* noop */ }
    }, []);

    // Restore session on launch — optionally gated by biometrics.
    useEffect(() => {
        (async () => {
            try {
                const [stored, { access }] = await Promise.all([tokens.getUser(), tokens.get()]);
                if (stored && access) {
                    const hasHardware = await LocalAuthentication.hasHardwareAsync();
                    const enrolled = await LocalAuthentication.isEnrolledAsync();
                    if (hasHardware && enrolled) {
                        const result = await LocalAuthentication.authenticateAsync({
                            promptMessage: 'Desbloquea Parallly',
                            fallbackLabel: 'Usar contraseña',
                        });
                        if (!result.success) { setLoading(false); return; }
                    }
                    setUser(stored);
                    loadVertical(stored.tenantId);
                }
            } catch { /* noop */ }
            setLoading(false);
        })();
    }, [loadVertical]);

    const login = useCallback(async (email: string, password: string) => {
        const res = await api.login(email, password);
        if (res?.success && res.data?.accessToken) {
            await tokens.set(res.data.accessToken, res.data.refreshToken);
            const u: AuthUser = res.data.user;
            await tokens.setUser(u);
            setUser(u);
            loadVertical(u.tenantId);
            return { ok: true };
        }
        return { ok: false, error: res?.error?.message || res?.message || 'Credenciales inválidas' };
    }, []);

    const logout = useCallback(async () => {
        disconnectSocket();
        await tokens.clear();
        setUser(null);
        setVerticalConfig(null);
    }, []);

    return (
        <AuthContext.Provider value={{ user, tenantId: user?.tenantId || null, verticalConfig, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}
