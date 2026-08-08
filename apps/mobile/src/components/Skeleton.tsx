import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, type DimensionValue } from 'react-native';
import { theme } from '../theme';

/**
 * Pulsing placeholder block (GATE 0 — estados de carga). Replaces bare spinners
 * so loading feels faster and the layout doesn't jump when data arrives.
 */
export function Skeleton({ width = '100%', height, radius = 8, delay = 0 }: { width?: DimensionValue; height: number; radius?: number; delay?: number }) {
    const opacity = useRef(new Animated.Value(0.35)).current;
    useEffect(() => {
        // El delay desfasa cada fila: el pulso en onda se lee orgánico; en
        // sincronía perfecta se leía mecánico.
        const loop = Animated.loop(
            Animated.sequence([
                Animated.delay(delay),
                Animated.timing(opacity, { toValue: 0.85, duration: 700, useNativeDriver: true }),
                Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
            ]),
        );
        loop.start();
        return () => loop.stop();
    }, [opacity, delay]);
    return <Animated.View style={{ width, height, borderRadius: radius, backgroundColor: theme.bgElevated, opacity }} />;
}

/** A conversation/lead-style row placeholder: avatar circle + two text lines. */
export function RowSkeleton({ delay = 0 }: { delay?: number }) {
    return (
        <View style={styles.row}>
            <Skeleton width={40} height={40} radius={20} delay={delay} />
            <View style={{ flex: 1, gap: 8 }}>
                <Skeleton width="55%" height={13} delay={delay} />
                <Skeleton width="80%" height={11} delay={delay} />
            </View>
        </View>
    );
}

/** A list of row placeholders. */
export function ListSkeleton({ rows = 7 }: { rows?: number }) {
    return (
        <View>
            {Array.from({ length: rows }).map((_, i) => <RowSkeleton key={i} delay={i * 90} />)}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth,
    },
});
