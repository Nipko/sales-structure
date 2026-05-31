import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { api, tokens, AuthUser } from '../lib/api';
import { disconnectSocket } from '../lib/socket';

interface AuthState {
    user: AuthUser | null;
    tenantId: string | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({} as AuthState);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);

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
                }
            } catch { /* noop */ }
            setLoading(false);
        })();
    }, []);

    const login = useCallback(async (email: string, password: string) => {
        const res = await api.login(email, password);
        if (res?.success && res.data?.accessToken) {
            await tokens.set(res.data.accessToken, res.data.refreshToken);
            const u: AuthUser = res.data.user;
            await tokens.setUser(u);
            setUser(u);
            return { ok: true };
        }
        return { ok: false, error: res?.error?.message || res?.message || 'Credenciales inválidas' };
    }, []);

    const logout = useCallback(async () => {
        disconnectSocket();
        await tokens.clear();
        setUser(null);
    }, []);

    return (
        <AuthContext.Provider value={{ user, tenantId: user?.tenantId || null, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}
