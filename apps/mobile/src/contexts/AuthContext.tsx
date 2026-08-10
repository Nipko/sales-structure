import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { useQueryClient } from '@tanstack/react-query';
import { api, tokens, setOnAuthFailure, AuthUser } from '../lib/api';
import { disconnectSocket } from '../lib/socket';
import { activateOutboxScope, clearAllOutboxStorage, deactivateOutboxScope } from '../lib/outbox';
import { deactivatePushScope, unregisterPushForLogout } from '../lib/push';
import { setUnreadTotal } from '../lib/unread';

// Re-lock biométrico tras background prolongado. 15 min: a los 90s originales
// cada cambio de app (responder un WhatsApp personal, mirar el calendario)
// volvía a exigir huella — se percibía como "me pide loguearme cada rato".
const RELOCK_AFTER_MS = 15 * 60_000;

// Backend rejects a 2nd concurrent session unless force=true. On a personal phone
// we always take over our own prior session (e.g. after an unclean exit / crash).
const isSessionConflict = (res: any) =>
    res?.error === 'session_conflict' ||
    (typeof res?.message === 'string' && res.message.toLowerCase().includes('sesión activa'));

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
    const queryClient = useQueryClient();
    const [user, setUser] = useState<AuthUser | null>(null);
    const [verticalConfig, setVerticalConfig] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [locked, setLocked] = useState(false);
    const bgAt = useRef<number | null>(null);
    // A dead-session cleanup may still be deleting SecureStore/AsyncStorage when
    // the user quickly signs in as someone else. New credentials must never race
    // with that cleanup (which could otherwise erase the new session).
    const authFailureCleanup = useRef<Promise<void>>(Promise.resolve());

    // Load the tenant's vertical config (terminology) — best-effort.
    const loadVertical = useCallback(async (tenantId?: string) => {
        if (!tenantId) return;
        try {
            const res: any = await api.getVerticalConfig(tenantId);
            if (res?.success && res.data) setVerticalConfig(res.data);
        } catch { /* noop */ }
    }, []);

    // Restore session on launch. La sesión se restaura SIEMPRE que haya tokens:
    // la biometría es un CANDADO (LockGate encima de la app), no la sesión.
    // Antes, cancelar/fallar el prompt hacía `return` sin restaurar y el agente
    // caía al FORMULARIO de login con tokens perfectamente válidos — la causa #1
    // del "me pide loguearme cada rato".
    useEffect(() => {
        (async () => {
            try {
                const [stored, { access }] = await Promise.all([tokens.getUser(), tokens.get()]);
                if (stored && access) {
                    if (stored.id && stored.tenantId) {
                        await activateOutboxScope(stored.id, stored.tenantId);
                    } else {
                        deactivateOutboxScope();
                    }
                    setUser(stored);
                    loadVertical(stored.tenantId);
                    const [hasHardware, enrolled] = await Promise.all([
                        LocalAuthentication.hasHardwareAsync().catch(() => false),
                        LocalAuthentication.isEnrolledAsync().catch(() => false),
                    ]);
                    if (hasHardware && enrolled) {
                        setLocked(true);
                        setLoading(false);
                        // Prompt inmediato; si falla/cancela queda el LockGate con
                        // "Desbloquear" para reintentar — nunca el login.
                        const result = await LocalAuthentication.authenticateAsync({
                            promptMessage: 'Desbloquea Parallly',
                            fallbackLabel: 'Usar contraseña',
                        }).catch(() => ({ success: false } as const));
                        if (result.success) setLocked(false);
                        return;
                    }
                }
            } catch { /* noop */ }
            setLoading(false);
        })();
    }, [loadVertical]);

    const applyAuth = useCallback(async (res: any, fallbackError: string): Promise<LoginResult> => {
        if (res?.success && res.data?.accessToken) {
            await authFailureCleanup.current.catch(() => {});
            await tokens.set(res.data.accessToken, res.data.refreshToken);
            // Persist the device-trust token so future logins skip 2FA on this device.
            if (res.data.deviceTrustToken) await tokens.setDeviceTrust(res.data.deviceTrustToken);
            const u: AuthUser = res.data.user;
            await tokens.setUser(u);
            if (u.id && u.tenantId) {
                await activateOutboxScope(u.id, u.tenantId);
            } else {
                deactivateOutboxScope();
            }
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
        // Código propio del backend (p. ej. 'no_account' cuando alguien entra con
        // Google desde el móvil sin tener cuenta): se propaga tal cual para que la
        // pantalla muestre el mensaje correcto en vez del genérico.
        if (typeof res?.error === 'string') return { ok: false, error: res.error };
        return { ok: false, error: res?.error?.message || res?.message || fallbackError };
    }, [loadVertical]);

    const login = useCallback(async (email: string, password: string) => {
        const dt = (await tokens.getDeviceTrust()) || undefined;
        let res = await api.login(email, password, dt, false);
        if (isSessionConflict(res)) res = await api.login(email, password, dt, true);
        return applyAuth(res, 'Credenciales inválidas');
    }, [applyAuth]);

    const loginWithGoogle = useCallback(async (idToken: string) => {
        const dt = (await tokens.getDeviceTrust()) || undefined;
        let res = await api.googleLogin(idToken, dt, false);
        if (isSessionConflict(res)) res = await api.googleLogin(idToken, dt, true);
        return applyAuth(res, 'No se pudo iniciar sesión con Google');
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

    const clearSensitiveLocalState = useCallback(async () => {
        // Synchronous boundaries first: no reconnect can flush/render the prior
        // account while the slower device-storage deletes are in progress.
        deactivateOutboxScope();
        const pushCleanup = deactivatePushScope();
        setUnreadTotal(0);
        queryClient.clear();

        await Promise.all([clearAllOutboxStorage(), pushCleanup]);
        // Names, previews and customer content are plaintext AsyncStorage cache.
        // Remove every account's old/legacy key on logout or a dead session.
        try {
            const keys = await AsyncStorage.getAllKeys();
            const inboxKeys = keys.filter((key) => key.startsWith('inbox:last:'));
            if (inboxKeys.length) await AsyncStorage.multiRemove(inboxKeys);
        } catch { /* noop */ }
    }, [queryClient]);

    const logout = useCallback(async () => {
        // Unmount data screens immediately so an in-flight query cannot repopulate
        // a cache after the logout purge while the network cleanup is running.
        setLoading(true);
        disconnectSocket();
        deactivateOutboxScope();
        try {
            // Revoke push while the authenticated access token still exists. This
            // must precede auth/logout and local token deletion so the old account
            // cannot keep receiving customer notifications after an account switch.
            if (user?.id && user.tenantId) {
                await unregisterPushForLogout(user.id, user.tenantId).catch(() => false);
            } else {
                await deactivatePushScope();
            }

            // Kill the server session next, so a later login doesn't hit an active session.
            try { const { refresh } = await tokens.get(); if (refresh) await api.logout(refresh); } catch { /* noop */ }
            await clearSensitiveLocalState().catch(() => {});
            await tokens.clear().catch(() => {});
            // Seguridad (GATE 0): un logout EXPLÍCITO también olvida este dispositivo,
            // de modo que el próximo inicio de sesión vuelve a exigir 2FA (no queremos
            // que el 30-day device-trust sobreviva a un "cerrar sesión" intencional).
            await tokens.clearDeviceTrust().catch(() => { /* noop */ });
        } finally {
            setUser(null);
            setVerticalConfig(null);
            setLocked(false);
            setLoading(false);
        }
    }, [clearSensitiveLocalState, user]);

    // If a token refresh fails mid-session, the session is dead → return to login
    // instead of leaving the user "inside" the app with everything failing silently.
    useEffect(() => {
        setOnAuthFailure(() => {
            disconnectSocket();
            authFailureCleanup.current = (async () => {
                await clearSensitiveLocalState();
                await tokens.clear().catch(() => { /* noop */ });
            })();
            setVerticalConfig(null);
            setUser(null);
            setLocked(false);
        });
        return () => setOnAuthFailure(null);
    }, [clearSensitiveLocalState]);

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
