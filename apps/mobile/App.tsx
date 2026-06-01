import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { RootNavigator, navigationRef } from './src/navigation/RootNavigator';
import { theme } from './src/theme';

const navTheme = {
    ...DarkTheme,
    colors: {
        ...DarkTheme.colors,
        background: theme.bg,
        card: theme.bgCard,
        text: theme.text,
        border: theme.border,
        primary: theme.accent,
    },
};

/** Full-screen biometric lock shown after the app was backgrounded a while. */
function LockGate() {
    const { locked, unlock } = useAuth();
    if (!locked) return null;
    return (
        <View style={styles.lock}>
            <Ionicons name="lock-closed" size={42} color={theme.accent} />
            <Text style={styles.lockTitle}>Parallly bloqueado</Text>
            <Text style={styles.lockSub}>Desbloquea para continuar</Text>
            <TouchableOpacity style={styles.lockBtn} onPress={unlock}>
                <Ionicons name="finger-print" size={20} color="#fff" />
                <Text style={styles.lockBtnText}>Desbloquear</Text>
            </TouchableOpacity>
        </View>
    );
}

export default function App() {
    return (
        <SafeAreaProvider>
            <AuthProvider>
                <NavigationContainer theme={navTheme} ref={navigationRef}>
                    <RootNavigator />
                </NavigationContainer>
                <LockGate />
                <StatusBar style="light" />
            </AuthProvider>
        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    lock: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: 10 },
    lockTitle: { color: theme.text, fontSize: 20, fontWeight: '700', marginTop: 8 },
    lockSub: { color: theme.textSecondary, fontSize: 14, marginBottom: 20 },
    lockBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.accent, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 12 },
    lockBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
