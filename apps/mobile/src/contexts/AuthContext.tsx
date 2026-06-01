import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { api, tokens, AuthUser } from '../lib/api';
import { disconnectSocket } from '../lib/socket';

const RELOCK_AFTER_MS = 90_000; // re-prompt biometrics if backgrounded > 90s

export type TwoFAMethod = 'totp' | 'email' | 'backup';

// Result of any auth attempt. `requires2FA` means the credentials were valid but
// the account has two-factor enabled → caller must collect a code and call verifyTwoFactor.
export interface LoginResult {
    ok: boolean;
    error?: string;
    requires2FA?: boolean;
    twoFAToken?: string;
    method?: TwoFAMethod;
    email?: string;
}

interface AuthState {
    user: AuthUser | null;
    tenantId: string | null;
    verticalConfig: any | null;
    loading: boolean;
    locked: boolean;
    unlock: () => Promise<void>;
    login: (email: string, password: string) => Promise<LoginResult>;
    loginWithGoogle: (idToken: string) => Promise<LoginResult>;
    verifyTwoFactor: (twoFAToken: string, code: string, method: TwoFAMethod, trustDevice?: boolean) => Promise<LoginResult>;
    sendTwoFactorEmail: (twoFAToken: string) => Promise<boolean>;
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

    const applyAuth = useCallback(async (res: any, fallbackError: string): Promise<LoginResult> => {
        if (res?.success && res.data?.accessToken) {
            await tokens.set(res.data.accessToken, res.data.refreshToken);
            // Persist the device-trust token so future logins skip 2FA on this device.
            if (res.data.deviceTrustToken) await tokens.setDeviceTrust(res.data.deviceTrustToken);
            const u: AuthUser = res.data.user;
            await tokens.setUser(u);
            setUser(u);
            loadVertical(u.tenantId);
            return { ok: true };
        }
        // Valid credentials, but the account has 2FA — caller must collect a code.
        if (res?.success && res.data?.requires2FA && res.data?.twoFAToken) {
            return {
                ok: false,
                requires2FA: true,
                twoFAToken: res.data.twoFAToken,
                method: (res.data.twoFactorMethod as TwoFAMethod) || 'totp',
                email: res.data.user?.email,
            };
        }
        return { ok: false, error: res?.error?.message || res?.message || fallbackError };
    }, [loadVertical]);

    const login = useCallback(async (email: string, password: string) => {
        const dt = await tokens.getDeviceTrust();
        return applyAuth(await api.login(email, password, dt || undefined), 'Credenciales inválidas');
    }, [applyAuth]);

    const loginWithGoogle = useCallback(async (idToken: string) => {
        const dt = await tokens.getDeviceTrust();
        return applyAuth(await api.googleLogin(idToken, dt || undefined), 'No se pudo iniciar sesión con Google');
    }, [applyAuth]);

    const verifyTwoFactor = useCallback(async (twoFAToken: string, code: string, method: TwoFAMethod, trustDevice = true) => {
        try {
            return await applyAuth(await api.verify2FA(twoFAToken, code, method, true, trustDevice), 'Código incorrecto');
        } catch (e: any) {
            return { ok: false, error: e?.message || 'No se pudo verificar el código' };
        }
    }, [applyAuth]);

    const sendTwoFactorEmail = useCallback(async (twoFAToken: string) => {
        try {
            const r = await api.send2FAEmail(twoFAToken);
            return !!r?.success;
        } catch {
            return false;
        }
    }, []);

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
        <AuthContext.Provider value={{ user, tenantId: user?.tenantId || null, verticalConfig, loading, locked, unlock, login, loginWithGoogle, verifyTwoFactor, sendTwoFactorEmail, logout }}>
            {children}
        </AuthContext.Provider>
    );
}
