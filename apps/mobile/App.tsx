import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme, LinkingOptions } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { RootNavigator, navigationRef } from './src/navigation/RootNavigator';
import { ToastProvider } from './src/components/Toast';
import { I18nProvider } from './src/i18n';
import { theme } from './src/theme';

// Observabilidad (GATE 0): inicializa Sentry lo antes posible. DSN desde app.config
// (extra.sentryDsn / EXPO_PUBLIC_SENTRY_DSN). Si no hay DSN, queda deshabilitado sin romper.
const sentryDsn = (Constants.expoConfig?.extra as any)?.sentryDsn as string | undefined;
Sentry.init({
    dsn: sentryDsn,
    enabled: !!sentryDsn && !__DEV__, // no enviar ruido desde dev/Metro
    sendDefaultPii: false,
    tracesSampleRate: 0.2,
    attachStacktrace: true,
});

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

/**
 * URL deep-linking (scheme `parallly://`). Complements the push-tap navigation
 * (which routes imperatively via navigationRef). Enables links like
 * `parallly://conversation/<id>`, `parallly://lead/<id>`, `parallly://pipeline`,
 * and cold-start from a URL. Mirrors the RootNavigator structure.
 */
const linking: LinkingOptions<any> = {
    prefixes: ['parallly://'],
    config: {
        screens: {
            Main: {
                screens: {
                    Inbox: {
                        screens: {
                            InboxList: 'inbox',
                            Conversation: 'conversation/:conversationId',
                        },
                    },
                    CRM: {
                        screens: {
                            CrmList: 'crm',
                            LeadDetail: 'lead/:leadId',
                            Pipeline: 'pipeline',
                        },
                    },
                    Citas: 'citas',
                    'Más': 'mas',
                },
            },
            Login: 'login',
        },
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

function App() {
    return (
        <SafeAreaProvider>
            <AuthProvider>
                <I18nProvider>
                    <ToastProvider>
                        <NavigationContainer theme={navTheme} ref={navigationRef} linking={linking}>
                            <RootNavigator />
                        </NavigationContainer>
                        <LockGate />
                        <StatusBar style="light" />
                    </ToastProvider>
                </I18nProvider>
            </AuthProvider>
        </SafeAreaProvider>
    );
}

// Sentry.wrap añade ErrorBoundary, captura nativa de crashes y tracing de navegación.
export default Sentry.wrap(App);

const styles = StyleSheet.create({
    lock: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: 10 },
    lockTitle: { color: theme.text, fontSize: 20, fontWeight: '700', marginTop: 8 },
    lockSub: { color: theme.textSecondary, fontSize: 14, marginBottom: 20 },
    lockBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.accent, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 12 },
    lockBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
