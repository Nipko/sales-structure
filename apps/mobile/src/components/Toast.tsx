import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import { Animated, StyleSheet, Text, View, Easing, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { haptic } from '../lib/haptics';

type ToastType = 'success' | 'error' | 'info';
export interface ToastAction { label: string; onPress: () => void }
interface ToastState { message: string; type: ToastType; action?: ToastAction }

interface ToastApi {
    show: (message: string, type?: ToastType, action?: ToastAction) => void;
    success: (message: string, action?: ToastAction) => void;
    error: (message: string, action?: ToastAction) => void;
    info: (message: string, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const META: Record<ToastType, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
    success: { color: theme.success, icon: 'checkmark-circle' },
    error: { color: theme.danger, icon: 'alert-circle' },
    info: { color: theme.accent, icon: 'information-circle' },
};

/**
 * App-wide toast. Replaces silent failures / false-success Alerts with explicit,
 * non-blocking feedback. Part of GATE 0 (manejo de errores explícito).
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toast, setToast] = useState<ToastState | null>(null);
    const opacity = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(20)).current;
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const hide = useCallback(() => {
        Animated.parallel([
            Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
            Animated.timing(translateY, { toValue: 20, duration: 180, useNativeDriver: true }),
        ]).start(() => setToast(null));
    }, [opacity, translateY]);

    const show = useCallback((message: string, type: ToastType = 'info', action?: ToastAction) => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        // Tactile echo of the visual feedback — lets the field agent feel the
        // result without looking (manos ocupadas / en movimiento).
        if (type === 'success') haptic.success();
        else if (type === 'error') haptic.error();
        setToast({ message, type, action });
        opacity.setValue(0); translateY.setValue(20);
        Animated.parallel([
            Animated.timing(opacity, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(translateY, { toValue: 0, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start();
        // Give the agent time to hit "Undo" — actions linger longer than plain toasts.
        hideTimer.current = setTimeout(hide, action ? 5000 : type === 'error' ? 4000 : 2600);
    }, [opacity, translateY, hide]);

    const api = useRef<ToastApi>({
        show,
        success: (m: string, a?: ToastAction) => show(m, 'success', a),
        error: (m: string, a?: ToastAction) => show(m, 'error', a),
        info: (m: string, a?: ToastAction) => show(m, 'info', a),
    }).current;
    // keep closures fresh
    api.show = show;
    api.success = (m: string, a?: ToastAction) => show(m, 'success', a);
    api.error = (m: string, a?: ToastAction) => show(m, 'error', a);
    api.info = (m: string, a?: ToastAction) => show(m, 'info', a);

    // Clear any pending auto-dismiss timer on unmount (avoids late state updates).
    useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

    return (
        <ToastContext.Provider value={api}>
            {children}
            {toast && (
                <Animated.View pointerEvents="box-none" accessibilityLiveRegion="polite" accessible
                    style={[styles.wrap, { opacity, transform: [{ translateY }] }]}>
                    <View style={[styles.toast, { borderLeftColor: META[toast.type].color }]}>
                        <Ionicons name={META[toast.type].icon} size={20} color={META[toast.type].color} />
                        <Text style={styles.text} numberOfLines={3}>{toast.message}</Text>
                        {toast.action && (
                            <Pressable
                                onPress={() => { const a = toast.action; hide(); a?.onPress(); }}
                                hitSlop={8} accessibilityRole="button" accessibilityLabel={toast.action.label}
                                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}>
                                <Text style={styles.actionText}>{toast.action.label}</Text>
                            </Pressable>
                        )}
                    </View>
                </Animated.View>
            )}
        </ToastContext.Provider>
    );
}

/** Access the toast API. Safe no-op if provider is missing (shouldn't happen). */
export function useToast(): ToastApi {
    const ctx = useContext(ToastContext);
    if (ctx) return ctx;
    return { show: () => {}, success: () => {}, error: () => {}, info: () => {} };
}

const styles = StyleSheet.create({
    wrap: { position: 'absolute', left: 16, right: 16, bottom: 90, alignItems: 'center' },
    toast: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: theme.bgElevated, borderLeftWidth: 3,
        paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12,
        maxWidth: 520, width: '100%',
        shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
    },
    text: { color: theme.text, fontSize: 14, flex: 1 },
    action: { paddingHorizontal: 10, paddingVertical: 6, marginLeft: 4, borderRadius: 8, backgroundColor: theme.accent + '22' },
    actionText: { color: theme.accent, fontSize: 13, fontWeight: '700' },
});
