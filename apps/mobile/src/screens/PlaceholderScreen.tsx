import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

export function PlaceholderScreen({ title, subtitle, showLogout }: { title: string; subtitle?: string; showLogout?: boolean }) {
    const { user, logout } = useAuth();
    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.center}>
                <Ionicons name="construct-outline" size={40} color={theme.textSecondary} />
                <Text style={styles.title}>{title}</Text>
                {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
            {showLogout && (
                <View style={styles.footer}>
                    <Text style={styles.user}>{user?.name || user?.email}</Text>
                    <TouchableOpacity style={styles.logout} onPress={logout}>
                        <Ionicons name="log-out-outline" size={18} color={theme.danger} />
                        <Text style={styles.logoutText}>Cerrar sesión</Text>
                    </TouchableOpacity>
                </View>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    title: { color: theme.text, fontSize: 20, fontWeight: '700', marginTop: 16 },
    subtitle: { color: theme.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 8 },
    footer: { padding: 20, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
    user: { color: theme.textSecondary, fontSize: 13, marginBottom: 12, textAlign: 'center' },
    logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
    logoutText: { color: theme.danger, fontSize: 15, fontWeight: '600' },
});
