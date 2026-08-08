/**
 * Feedback táctil de escala (1 → 0.97 con spring, native driver) para filas y
 * tarjetas — el dimming por opacidad del TouchableOpacity no comunica "esto es
 * físico". Mantiene la API de onPress/onLongPress para ser drop-in.
 */
import React, { useRef } from 'react';
import { Pressable, Animated, ViewStyle, StyleProp } from 'react-native';

interface Props {
    onPress?: () => void;
    onLongPress?: () => void;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
    accessibilityRole?: 'button';
    accessibilityLabel?: string;
    accessibilityHint?: string;
    children: React.ReactNode;
}

export function PressableScale({ onPress, onLongPress, disabled, style, children, ...a11y }: Props) {
    const scale = useRef(new Animated.Value(1)).current;
    const to = (v: number) => Animated.spring(scale, { toValue: v, bounciness: 0, speed: 40, useNativeDriver: true }).start();
    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            disabled={disabled}
            onPressIn={() => to(0.97)}
            onPressOut={() => to(1)}
            {...a11y}
        >
            <Animated.View style={[style, { transform: [{ scale }] }]}>
                {children}
            </Animated.View>
        </Pressable>
    );
}
