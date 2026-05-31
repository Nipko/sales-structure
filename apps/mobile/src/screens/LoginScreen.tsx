import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

export function LoginScreen() {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!email.trim() || !password) return;
        setLoading(true); setError(null);
        const res = await login(email.trim(), password);
        if (!res.ok) setError(res.error || 'No se pudo iniciar sesión');
        setLoading(false);
    };

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.inner}>
                <Text style={styles.logo}>Parallly</Text>
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
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg },
    inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
    logo: { color: theme.text, fontSize: 34, fontWeight: '700', textAlign: 'center' },
    subtitle: { color: theme.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 36 },
    input: {
        backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, borderRadius: 12,
        paddingHorizontal: 16, paddingVertical: 14, color: theme.text, fontSize: 15, marginBottom: 12,
    },
    error: { color: theme.danger, fontSize: 13, marginBottom: 8, textAlign: 'center' },
    button: { backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
