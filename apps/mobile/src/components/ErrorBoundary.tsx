import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import { useI18n } from '../i18n';
import { theme } from '../theme';

interface Props { children: React.ReactNode }
interface State { hasError: boolean }

/**
 * GATE 0 (robustez): captura errores de render de React para que un fallo en una
 * pantalla NO deje la app en blanco/crasheada. Reporta a Sentry y muestra una UI
 * de recuperación con "reintentar". Complementa Sentry.wrap (crashes nativos).
 */
export class ErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        Sentry.captureException(error, {
            extra: { componentStack: info?.componentStack },
        });
    }

    reset = () => this.setState({ hasError: false });

    render() {
        if (this.state.hasError) return <Fallback onRetry={this.reset} />;
        return this.props.children;
    }
}

/** Pantalla de recuperación. Es un componente función para poder usar i18n. */
function Fallback({ onRetry }: { onRetry: () => void }) {
    const { t } = useI18n();
    return (
        <View style={styles.wrap}>
            <Ionicons name="alert-circle-outline" size={48} color={theme.danger} />
            <Text style={styles.title}>{t('error.title')}</Text>
            <Text style={styles.body}>{t('error.body')}</Text>
            <TouchableOpacity
                style={styles.btn}
                onPress={onRetry}
                accessibilityRole="button"
                accessibilityLabel={t('error.retry')}
            >
                <Ionicons name="refresh" size={18} color="#fff" />
                <Text style={styles.btnText}>{t('error.retry')}</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
    title: { color: theme.text, fontSize: 19, fontWeight: '700', marginTop: 8, textAlign: 'center' },
    body: { color: theme.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
    btn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.accent, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 12 },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
