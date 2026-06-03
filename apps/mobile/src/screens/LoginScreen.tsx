import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Image, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { useAuth, TwoFAMethod } from '../contexts/AuthContext';
import { useI18n } from '../i18n';
import { DASHBOARD_URL } from '../lib/config';
import { theme } from '../theme';

const WEB_CLIENT_ID = (Constants.expoConfig?.extra as any)?.googleWebClientId || '';
// Google Sign-In is a native module → unavailable in Expo Go, only in a dev/prod build.
const googleAvailable = !!WEB_CLIENT_ID && Constants.executionEnvironment !== 'storeClient';

interface TwoFAState { token: string; method: TwoFAMethod; email?: string }

export function LoginScreen() {
    const { login, loginWithGoogle, verifyTwoFactor, sendTwoFactorEmail } = useAuth();
    const { t } = useI18n();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 2FA challenge state (set when login/google returns requires2FA)
    const [twoFA, setTwoFA] = useState<TwoFAState | null>(null);
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
        setError(res.error || fallback);
    };

    const submit = async () => {
        if (!email.trim() || !password) return;
        setLoading(true); setError(null);
        handleResult(await login(email.trim(), password), t('login.signInError'));
        setLoading(false);
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
                setError(e?.message || t('login.googleGeneric'));
            }
        }
        setGoogleLoading(false);
    };

    // ── 2FA step ──────────────────────────────────────────────
    const effectiveMethod: TwoFAMethod = useBackup ? 'backup' : (twoFA?.method || 'totp');

    const verify = async () => {
        if (!twoFA || !code.trim()) return;
        setVerifying(true); setError(null);
        const res = await verifyTwoFactor(twoFA.token, code.trim(), effectiveMethod, trustDevice);
        if (!res.ok) setError(res.error || t('login.codeWrong'));
        // On success the AuthProvider sets `user` and this screen unmounts.
        setVerifying(false);
    };

    const sendEmailCode = async () => {
        if (!twoFA) return;
        setEmailSending(true); setError(null);
        const ok = await sendTwoFactorEmail(twoFA.token);
        setEmailSending(false);
        if (ok) {
            setTwoFA({ ...twoFA, method: 'email' });
            setUseBackup(false); setCode(''); setEmailSent(true);
        } else {
            setError(t('login.emailSendError'));
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
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.inner}>
                <Image
                    source={require('../../assets/logo-wordmark.png')}
                    style={styles.logo}
                    resizeMode="contain"
                />
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
            </KeyboardAvoidingView>
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
    link: { color: theme.accent, fontSize: 14, fontWeight: '600' },
    linkMuted: { color: theme.textSecondary, fontSize: 14 },
});
