/**
 * Barra de identidad: marca Parallly (izquierda) + tenant (logo o monograma +
 * nombre, derecha) + acción opcional. Patrón Facebook/Instagram: se esconde al
 * hacer scroll hacia abajo y reaparece al subir (prop `hidden`, animada acá con
 * altura+opacidad — la pantalla solo decide cuándo).
 *
 * El logo del tenant sale de business-info (empresa primaria, best-effort con
 * caché en memoria); si no hay, un monograma con la inicial del negocio.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Animated, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { API_URL } from '../lib/config';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

const BAR_HEIGHT = 46;
const WORDMARK = require('../../assets/logo-wordmark.png');

// Caché por proceso: el logo no cambia dentro de una sesión de uso.
let cachedLogo: { tenantId: string; url: string | null } | null = null;

function mediaUrl(raw?: string | null): string | null {
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    return API_URL.replace(/\/api\/v1\/?$/, '') + raw;
}

interface Props {
    hidden?: boolean;
    actionIcon?: keyof typeof Ionicons.glyphMap;
    actionLabel?: string;
    onAction?: () => void;
}

export function BrandHeader({ hidden = false, actionIcon, actionLabel, onAction }: Props) {
    const { user, tenantId } = useAuth();
    const [logo, setLogo] = useState<string | null>(cachedLogo?.tenantId === tenantId ? cachedLogo.url : null);
    const anim = useRef(new Animated.Value(hidden ? 0 : 1)).current;

    useEffect(() => {
        Animated.timing(anim, { toValue: hidden ? 0 : 1, duration: 180, useNativeDriver: false }).start();
    }, [hidden, anim]);

    useEffect(() => {
        if (!tenantId || (cachedLogo && cachedLogo.tenantId === tenantId)) return;
        api.getBusinessInfo(tenantId).then((r: any) => {
            const companies = Array.isArray(r?.data) ? r.data : (r?.data ? [r.data] : []);
            const primary = companies.find((c: any) => c.is_primary) || companies[0];
            const url = mediaUrl(primary?.logo_url);
            cachedLogo = { tenantId, url };
            setLogo(url);
        }).catch(() => { cachedLogo = { tenantId, url: null }; });
    }, [tenantId]);

    const tenantName = (user as any)?.tenantName || '';
    const initial = (tenantName || '?').trim().charAt(0).toUpperCase();

    return (
        <Animated.View style={[styles.wrap, {
            height: anim.interpolate({ inputRange: [0, 1], outputRange: [0, BAR_HEIGHT] }),
            opacity: anim,
        }]}>
            <Image source={WORDMARK} style={styles.wordmark} resizeMode="contain" />
            <View style={styles.right}>
                {!!tenantName && (
                    <View style={styles.tenantChip} accessible accessibilityLabel={tenantName}>
                        {logo ? (
                            <Image source={{ uri: logo }} style={styles.tenantLogo} />
                        ) : (
                            <View style={styles.monogram}><Text style={styles.monogramText}>{initial}</Text></View>
                        )}
                        <Text style={styles.tenantName} numberOfLines={1}>{tenantName}</Text>
                    </View>
                )}
                {!!actionIcon && (
                    <TouchableOpacity onPress={onAction} style={styles.actionBtn}
                        accessibilityRole="button" accessibilityLabel={actionLabel}>
                        <Ionicons name={actionIcon} size={22} color={theme.accent} />
                    </TouchableOpacity>
                )}
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, overflow: 'hidden', backgroundColor: theme.bg,
    },
    wordmark: { width: 96, height: 16 },
    right: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
    tenantChip: {
        flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1,
        backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1,
        borderRadius: 15, paddingLeft: 3, paddingRight: 10, paddingVertical: 3,
    },
    tenantLogo: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.bgElevated },
    monogram: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.accent + '33', alignItems: 'center', justifyContent: 'center' },
    monogramText: { color: theme.accent, fontSize: 12, fontWeight: '700' },
    tenantName: { color: theme.text, fontSize: 12, fontWeight: '600', maxWidth: 140 },
    actionBtn: { padding: 6 },
});
