import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { api, tokens, AuthUser } from '../lib/api';
import { disconnectSocket } from '../lib/socket';

const RELOCK_AFTER_MS = 90_000; // re-prompt biometrics if backgrounded > 90s

interface AuthState {
    user: AuthUser | null;
    tenantId: string | null;
    verticalConfig: any | null;
    loading: boolean;
    locked: boolean;
    unlock: () => Promise<void>;
    login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
    loginWithGoogle: (idToken: string) => Promise<{ ok: boolean; error?: string }>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({} as AuthState);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [verticalConfig, setVerticalConfig] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [locked, setLocked] = useState(false);
    const bgAt = useRef<number | null>(null);

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

    const applyAuth = useCallback(async (res: any, fallbackError: string) => {
        if (res?.success && res.data?.accessToken) {
            await tokens.set(res.data.accessToken, res.data.refreshToken);
            const u: AuthUser = res.data.user;
            await tokens.setUser(u);
            setUser(u);
            loadVertical(u.tenantId);
            return { ok: true };
        }
        return { ok: false, error: res?.error?.message || res?.message || fallbackError };
    }, [loadVertical]);

    const login = useCallback(async (email: string, password: string) => {
        return applyAuth(await api.login(email, password), 'Credenciales inválidas');
    }, [applyAuth]);

    const loginWithGoogle = useCallback(async (idToken: string) => {
        return applyAuth(await api.googleLogin(idToken), 'No se pudo iniciar sesión con Google');
    }, [applyAuth]);

    const logout = useCallback(async () => {
        disconnectSocket();
        await tokens.clear();
        setUser(null);
        setVerticalConfig(null);
        setLocked(false);
    }, []);

    const unlock = useCallback(async () => {
        try {
            const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Desbloquea Parallly', fallbackLabel: 'Usar contraseña' });
            if (res.success) setLocked(false);
        } catch { /* keep locked */ }
    }, []);

    // Re-lock with biometrics after the app has been backgrounded a while.
    useEffect(() => {
        const sub = AppState.addEventListener('change', async (state) => {
            if (state === 'background' || state === 'inactive') {
                bgAt.current = Date.now();
            } else if (state === 'active' && bgAt.current && user) {
                const away = Date.now() - bgAt.current;
                bgAt.current = null;
                if (away > RELOCK_AFTER_MS) {
                    const [hw, enrolled] = await Promise.all([
                        LocalAuthentication.hasHardwareAsync().catch(() => false),
                        LocalAuthentication.isEnrolledAsync().catch(() => false),
                    ]);
                    if (hw && enrolled) setLocked(true);
                }
            }
        });
        return () => sub.remove();
    }, [user]);

    return (
        <AuthContext.Provider value={{ user, tenantId: user?.tenantId || null, verticalConfig, loading, locked, unlock, login, loginWithGoogle, logout }}>
            {children}
        </AuthContext.Provider>
    );
}
