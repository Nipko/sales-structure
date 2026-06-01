import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

const WEB_CLIENT_ID = (Constants.expoConfig?.extra as any)?.googleWebClientId || '';
// Google Sign-In is a native module → unavailable in Expo Go, only in a dev/prod build.
const googleAvailable = !!WEB_CLIENT_ID && Constants.executionEnvironment !== 'storeClient';

export function LoginScreen() {
    const { login, loginWithGoogle } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (googleAvailable) {
            try { GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, offlineAccess: false }); } catch { /* noop */ }
        }
    }, []);

    const submit = async () => {
        if (!email.trim() || !password) return;
        setLoading(true); setError(null);
        const res = await login(email.trim(), password);
        if (!res.ok) setError(res.error || 'No se pudo iniciar sesión');
        setLoading(false);
    };

    const google = async () => {
        setGoogleLoading(true); setError(null);
        try {
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
            const result: any = await GoogleSignin.signIn();
            // Library v13+ returns { data: { idToken } }; older returns { idToken }.
            const idToken = result?.data?.idToken || result?.idToken;
            if (!idToken) { setError('Google no devolvió el token'); setGoogleLoading(false); return; }
            const res = await loginWithGoogle(idToken);
            if (!res.ok) setError(res.error || 'No se pudo iniciar con Google');
        } catch (e: any) {
            if (e?.code !== statusCodes.SIGN_IN_CANCELLED) {
                setError(e?.message || 'Error con Google Sign-In');
            }
        }
        setGoogleLoading(false);
    };

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.inner}>
                <Image
                    source={require('../../assets/logo-wordmark.png')}
                    style={styles.logo}
                    resizeMode="contain"
                />
                <Text style={styles.subtitle}>Consola de agentes</Text>

                <TextInput
                    style={styles.input}
                    placeholder="Email"
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                />
                <TextInput
                    style={styles.input}
                    placeholder="Contraseña"
                    placeholderTextColor={theme.textSecondary}
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                    onSubmitEditing={submit}
                />

                {error && <Text style={styles.error}>{error}</Text>}

                <TouchableOpacity style={styles.button} onPress={submit} disabled={loading}>
                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Iniciar sesión</Text>}
                </TouchableOpacity>

                {googleAvailable && (
                    <>
                        <View style={styles.divider}>
                            <View style={styles.line} /><Text style={styles.or}>o</Text><View style={styles.line} />
                        </View>
                        <TouchableOpacity style={styles.googleBtn} onPress={google} disabled={googleLoading}>
                            {googleLoading ? <ActivityIndicator color={theme.text} /> : (
                                <>
                                    <Ionicons name="logo-google" size={18} color="#EA4335" />
                                    <Text style={styles.googleText}>Continuar con Google</Text>
                                </>
                            )}
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
    button: { backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 18, gap: 10 },
    line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.border },
    or: { color: theme.textSecondary, fontSize: 13 },
    googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, borderRadius: 12, paddingVertical: 14 },
    googleText: { color: theme.text, fontSize: 15, fontWeight: '600' },
});
