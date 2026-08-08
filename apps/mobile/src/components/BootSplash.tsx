/**
 * Identidad de marca en el arranque y la reactivación — solo Animated core,
 * cero dependencias nuevas.
 *
 * - <BootSplashGate/>: splash animado del arranque en frío. Mismo fondo
 *   (#0a0a12) y artwork centrado que el splash nativo, así el handoff
 *   nativo→JS no tiene costura. Wordmark con fade+scale, barrido de acento y
 *   los "puntos de escritura" del chat — la identidad del producto: una IA
 *   que responde conversaciones. Se desvanece cuando la sesión restauró,
 *   con un mínimo en pantalla para no parpadear.
 * - <WelcomeBackFlash/>: destello de marca no bloqueante (~900ms) al volver
 *   del background tras un rato — pointerEvents:none, jamás demora un tap.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet, AppState } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

const MIN_SHOW_MS = 800;        // evita el flash de un splash de 100ms
const WELCOME_AFTER_MS = 2 * 60_000; // background > 2 min → saludo de marca

const WORDMARK = require('../../assets/logo-wordmark.png');

function useTypingDots(): Animated.Value[] {
    const dots = useRef([new Animated.Value(0.25), new Animated.Value(0.25), new Animated.Value(0.25)]).current;
    useEffect(() => {
        const anims = dots.map((d, i) => Animated.loop(Animated.sequence([
            Animated.delay(i * 150),
            Animated.timing(d, { toValue: 1, duration: 300, useNativeDriver: true }),
            Animated.timing(d, { toValue: 0.25, duration: 300, useNativeDriver: true }),
            Animated.delay((2 - i) * 150),
        ])));
        anims.forEach((a) => a.start());
        return () => anims.forEach((a) => a.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return dots;
}

export function BootSplashGate() {
    const { loading } = useAuth();
    const [gone, setGone] = useState(false);
    const mountedAt = useRef(Date.now());
    const logoOpacity = useRef(new Animated.Value(0)).current;
    const logoScale = useRef(new Animated.Value(0.92)).current;
    const sweep = useRef(new Animated.Value(0)).current;
    const fade = useRef(new Animated.Value(1)).current;
    const dots = useTypingDots();

    useEffect(() => {
        Animated.parallel([
            Animated.timing(logoOpacity, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            Animated.spring(logoScale, { toValue: 1, bounciness: 6, useNativeDriver: true }),
        ]).start();
        Animated.timing(sweep, { toValue: 1, duration: 550, delay: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (loading) return;
        const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - mountedAt.current));
        const tm = setTimeout(() => {
            Animated.timing(fade, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => setGone(true));
        }, wait);
        return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading]);

    if (gone) return null;
    return (
        // pointerEvents auto (default): mientras el splash está visible BLOQUEA
        // los taps — con 'none', un tap impaciente aterrizaba a ciegas en la fila
        // de conversación o el input de login invisibles debajo (~1s, imperceptible).
        <Animated.View style={[styles.wrap, { opacity: fade }]}>
            <Animated.Image
                source={WORDMARK}
                style={[styles.logo, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}
                resizeMode="contain"
            />
            <Animated.View style={[styles.sweep, { opacity: logoOpacity, transform: [{ scaleX: sweep }] }]} />
            <View style={styles.dotsRow}>
                {dots.map((d, i) => <Animated.View key={i} style={[styles.dot, { opacity: d }]} />)}
            </View>
        </Animated.View>
    );
}

export function WelcomeBackFlash() {
    const { user } = useAuth();
    const bgAt = useRef<number | null>(null);
    const opacity = useRef(new Animated.Value(0)).current;
    const scale = useRef(new Animated.Value(0.96)).current;
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const sub = AppState.addEventListener('change', (state) => {
            if (state === 'background' || state === 'inactive') {
                if (bgAt.current === null) bgAt.current = Date.now();
                return;
            }
            if (state !== 'active') return;
            const away = bgAt.current ? Date.now() - bgAt.current : 0;
            bgAt.current = null;
            if (!user || away < WELCOME_AFTER_MS) return;
            setVisible(true);
            opacity.setValue(0);
            scale.setValue(0.96);
            Animated.sequence([
                Animated.parallel([
                    Animated.timing(opacity, { toValue: 0.96, duration: 220, useNativeDriver: true }),
                    Animated.spring(scale, { toValue: 1, bounciness: 5, useNativeDriver: true }),
                ]),
                Animated.delay(420),
                Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }),
            ]).start(() => setVisible(false));
        });
        return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    if (!visible) return null;
    return (
        <Animated.View style={[styles.wrap, { opacity }]} pointerEvents="none">
            <Animated.Image source={WORDMARK} style={[styles.logo, { transform: [{ scale }] }]} resizeMode="contain" />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    wrap: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', zIndex: 99 },
    logo: { width: 220, height: 36 },
    sweep: { width: 150, height: 2, borderRadius: 1, backgroundColor: theme.accent, marginTop: 18 },
    dotsRow: { flexDirection: 'row', gap: 7, marginTop: 26 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.accent },
});
