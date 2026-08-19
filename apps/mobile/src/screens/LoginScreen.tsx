import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Linking, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as Sentry from '@sentry/react-native';
import { useAuth, TwoFAMethod } from '../contexts/AuthContext';
import { useI18n } from '../i18n';
import { useKeyboardSpace } from '../lib/useKeyboardSpace';
import { DASHBOARD_URL } from '../lib/config';
import { theme } from '../theme';

const WEB_CLIENT_ID = (Constants.expoConfig?.extra as any)?.googleWebClientId || '';
// Google Sign-In is a native module → unavailable in Expo Go, only in a dev/prod build.
const googleAvailable = !!WEB_CLIENT_ID && Constants.executionEnvironment !== 'storeClient';

interface TwoFAState { token: string; method: TwoFAMethod; email?: string }

export function LoginScreen() {
    const { login, loginWithGoogle, verifyTwoFactor, sendTwoFactorEmail } = useAuth();
    const { t } = useI18n();
    const kbSpace = useKeyboardSpace();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 2FA challenge state (set when login/google returns requires2FA)
    const [twoFA, setTwoFA] = useState<TwoFAState | null>(null);

    // Entrada de marca: el wordmark "aterriza" desde el splash (translateY+fade)
    // y el resto entra con un pequeño stagger — continuidad splash → login.
    const logoAnim = useRef(new Animated.Value(0)).current;
    const bodyAnim = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.stagger(90, [
            Animated.timing(logoAnim, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            Animated.timing(bodyAnim, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const [code, setCode] = useState('');
    const [useBackup, setUseBackup] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [emailSending, setEmailSending] = useState(false);
    const [emailSent, setEmailSent] = useState(false);
    const [trustDevice, setTrustDevice] = useState(true); // remember this device → skip 2FA next time

    useEffect(() => {
        if (googleAvailable) {
            try { GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, offlineAccess: false }); } catch { /* noop */ }
        }
    }, []);

    // Common handler: a login attempt either signs in, needs 2FA, or errors.
    const handleResult = (res: { ok: boolean; error?: string; requires2FA?: boolean; twoFAToken?: string; method?: TwoFAMethod; email?: string }, fallback: string) => {
        if (res.ok) return;
        if (res.requires2FA && res.twoFAToken) {
            setTwoFA({ token: res.twoFAToken, method: res.method || 'totp', email: res.email });
            setCode(''); setUseBackup(false); setEmailSent(false); setError(null);
            return;
        }
        // Caso propio del móvil: Google verificó la identidad pero no hay cuenta
        // (el alta es web). No enumera nada — el usuario acaba de probar SU correo.
        if (res.error === 'no_account') { setError(t('login.noAccountGoogle')); return; }
        // Seguridad (GATE 0): NO mostramos el mensaje crudo del backend (evita
        // enumeración de usuarios / info-disclosure). Mensaje genérico i18n.
        setError(fallback);
    };

    const submit = async () => {
        if (!email.trim() || !password) return;
        setLoading(true); setError(null);
        try {
            handleResult(await login(email.trim(), password), t('login.signInError'));
        } catch {
            // Auth normally resolves a normalized failure envelope. This final
            // boundary also covers native/network exceptions so the button can
            // never remain spinning after a malformed or empty response.
            setError(t('login.signInError'));
        } finally {
            setLoading(false);
        }
    };

    const google = async () => {
        setGoogleLoading(true); setError(null);
        try {
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
            // Clear any cached Google account so the chooser always appears
            // (otherwise it silently reuses the last account).
            try { await GoogleSignin.signOut(); } catch { /* no prior google session */ }
            const result: any = await GoogleSignin.signIn();
            // Library v13+ returns { data: { idToken } }; older returns { idToken }.
            const idToken = result?.data?.idToken || result?.idToken;
            if (!idToken) { setError(t('login.googleNoToken')); setGoogleLoading(false); return; }
            handleResult(await loginWithGoogle(idToken), t('login.googleError'));
        } catch (e: any) {
            if (e?.code !== statusCodes.SIGN_IN_CANCELLED) {
                // El codigo de estado se perdia: TODOS los fallos se colapsaban en
                // el mismo mensaje generico, asi que un DEVELOPER_ERROR (cliente
                // OAuth de Android mal registrado para el package + SHA-1 de firma)
                // era indistinguible de un problema de red. Sin el codigo, esto es
                // indiagnosticable en produccion.
                const code = e?.code ?? 'unknown';
                setError(`${t('login.googleGeneric')} (${code})`);
                Sentry.captureException(e, {
                    tags: { flow: 'google_signin', google_status_code: String(code) },
                });
            }
        } finally {
            setGoogleLoading(false);
        }
    };

    // ── 2FA step ──────────────────────────────────────────────
    const effectiveMethod: TwoFAMethod = useBackup ? 'backup' : (twoFA?.method || 'totp');

    const verify = async () => {
        if (!twoFA || !code.trim()) return;
        setVerifying(true); setError(null);
        try {
            const res = await verifyTwoFactor(twoFA.token, code.trim(), effectiveMethod, trustDevice);
            // Genérico (no propagar texto del backend).
            if (!res.ok) setError(t('login.codeWrong'));
            // On success the AuthProvider sets `user` and this screen unmounts.
        } catch {
            setError(t('login.codeWrong'));
        } finally {
            setVerifying(false);
        }
    };

    const sendEmailCode = async () => {
        if (!twoFA) return;
        setEmailSending(true); setError(null);
        try {
            const ok = await sendTwoFactorEmail(twoFA.token);
            if (!ok) throw new Error('send_failed');
            setTwoFA({ ...twoFA, method: 'email' });
            setUseBackup(false); setCode(''); setEmailSent(true);
        } catch {
            setError(t('login.emailSendError'));
        } finally {
            setEmailSending(false);
        }
    };

    const backToLogin = () => {
        setTwoFA(null); setCode(''); setUseBackup(false); setEmailSent(false); setError(null);
    };

    const codeDescription = useBackup
        ? t('login.code.backup')
        : effectiveMethod === 'email'
            ? t('login.code.email', { email: twoFA?.email || t('login.yourEmail') })
            : t('login.code.totp');

    return (
        <SafeAreaView style={styles.container}>
            <View style={[styles.inner, { paddingBottom: kbSpace }]}>
                <Animated.Image
                    source={require('../../assets/logo-wordmark.png')}
                    style={[styles.logo, {
                        opacity: logoAnim,
                        transform: [{ translateY: logoAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
                    }]}
                    resizeMode="contain"
                />
                <Animated.View style={{ opacity: bodyAnim, transform: [{ translateY: bodyAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
                <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

                {!twoFA ? (
                    <>
                        <TextInput
                            style={styles.input}
                            placeholder={t('login.email')}
                            placeholderTextColor={theme.textSecondary}
                            autoCapitalize="none"
                            keyboardType="email-address"
                            value={email}
                            onChangeText={setEmail}
                        />
                        <TextInput
                            style={styles.input}
                            placeholder={t('login.password')}
                            placeholderTextColor={theme.textSecondary}
                            secureTextEntry
                            value={password}
                            onChangeText={setPassword}
                            onSubmitEditing={submit}
                        />

                        {error && <Text style={styles.error}>{error}</Text>}

                        <TouchableOpacity style={styles.button} onPress={submit} disabled={loading}>
                            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t('login.signIn')}</Text>}
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => Linking.openURL(`${DASHBOARD_URL}/forgot-password`)} style={styles.linkBtn}
                            accessibilityRole="link" accessibilityLabel={t('login.forgot')}>
                            <Text style={styles.link}>{t('login.forgot')}</Text>
                        </TouchableOpacity>

                        {googleAvailable && (
                            <>
                                <View style={styles.divider}>
                                    <View style={styles.line} /><Text style={styles.or}>{t('login.or')}</Text><View style={styles.line} />
                                </View>
                                <TouchableOpacity style={styles.googleBtn} onPress={google} disabled={googleLoading}>
                                    {googleLoading ? <ActivityIndicator color={theme.text} /> : (
                                        <>
                                            <Ionicons name="logo-google" size={18} color="#EA4335" />
                                            <Text style={styles.googleText}>{t('login.google')}</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </>
                        )}

                        {/* El alta vive en la web (wizard de empresa): acá solo
                            se abre el navegador, nunca se crea cuenta desde la app. */}
                        <TouchableOpacity onPress={() => Linking.openURL(`${DASHBOARD_URL}/signup`)} style={styles.signupRow}
                            accessibilityRole="link" accessibilityLabel={t('login.noAccountCta')}>
                            <Text style={styles.signupMuted}>{t('login.noAccount')} </Text>
                            <Text style={styles.signupLink}>{t('login.noAccountCta')}</Text>
                        </TouchableOpacity>
                    </>
                ) : (
                    <>
                        <Text style={styles.twoFaTitle}>{t('login.twoFaTitle')}</Text>
                        <Text style={styles.twoFaDesc}>{codeDescription}</Text>

                        <TextInput
                            style={[styles.input, styles.codeInput]}
                            placeholder={useBackup ? t('login.backupPlaceholder') : '000000'}
                            placeholderTextColor={theme.textSecondary}
                            keyboardType={useBackup ? 'default' : 'number-pad'}
                            autoCapitalize={useBackup ? 'characters' : 'none'}
                            maxLength={useBackup ? 8 : 6}
                            value={code}
                            onChangeText={setCode}
                            autoFocus
                            onSubmitEditing={verify}
                        />

                        {emailSent && <Text style={styles.info}>{t('login.emailSent')}</Text>}
                        {error && <Text style={styles.error}>{error}</Text>}

                        <TouchableOpacity style={styles.checkboxRow} onPress={() => setTrustDevice(!trustDevice)} activeOpacity={0.7}>
                            <Ionicons name={trustDevice ? 'checkbox' : 'square-outline'} size={20} color={trustDevice ? theme.accent : theme.textSecondary} />
                            <Text style={styles.checkboxLabel}>{t('login.trustDevice')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.button} onPress={verify} disabled={verifying || !code.trim()}>
                            {verifying ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t('login.verify')}</Text>}
                        </TouchableOpacity>

                        {!useBackup && effectiveMethod !== 'email' && (
                            <TouchableOpacity onPress={sendEmailCode} disabled={emailSending} style={styles.linkBtn}>
                                <Text style={styles.link}>{emailSending ? t('login.sending') : t('login.getEmailCode')}</Text>
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={() => { setUseBackup(!useBackup); setCode(''); setError(null); }} style={styles.linkBtn}>
                            <Text style={styles.link}>{useBackup ? t('login.useNormal') : t('login.useBackup')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={backToLogin} style={styles.linkBtn}>
                            <Text style={styles.linkMuted}>{t('login.back')}</Text>
                        </TouchableOpacity>
                    </>
                )}
                </Animated.View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg },
    inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
    logo: { width: 244, height: 40, alignSelf: 'center' },
    subtitle: { color: theme.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 10, marginBottom: 36 },
    input: {
        backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, borderRadius: 12,
        paddingHorizontal: 16, paddingVertical: 14, color: theme.text, fontSize: 15, marginBottom: 12,
    },
    error: { color: theme.danger, fontSize: 13, marginBottom: 8, textAlign: 'center' },
    info: { color: theme.textSecondary, fontSize: 13, marginBottom: 8, textAlign: 'center' },
    button: { backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 18, gap: 10 },
    line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.border },
    or: { color: theme.textSecondary, fontSize: 13 },
    googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, borderRadius: 12, paddingVertical: 14 },
    googleText: { color: theme.text, fontSize: 15, fontWeight: '600' },
    twoFaTitle: { color: theme.text, fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
    twoFaDesc: { color: theme.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
    codeInput: { textAlign: 'center', fontSize: 22, letterSpacing: 6, fontWeight: '600' },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, marginBottom: 4 },
    checkboxLabel: { color: theme.textSecondary, fontSize: 13, flex: 1 },
    linkBtn: { alignItems: 'center', paddingVertical: 12 },
    signupRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', paddingVertical: 18 },
    signupMuted: { color: theme.textSecondary, fontSize: 14 },
    signupLink: { color: theme.accent, fontSize: 14, fontWeight: '700' },
    link: { color: theme.accent, fontSize: 14, fontWeight: '600' },
    linkMuted: { color: theme.textSecondary, fontSize: 14 },
});
