/**
 * Primer arranque (descarga desde Play Store, sin sesión previa).
 *
 * Por qué existe: la app es la CONSOLA DEL AGENTE, no el alta. Crear la empresa
 * requiere el wizard web (vertical, canales, agente), así que quien baja la app
 * sin cuenta caía en un formulario de login sin contexto ni salida — mal primer
 * contacto y riesgo con la política de funcionalidad mínima de Google Play.
 * Acá se explica qué es Parallly, se ofrece el alta en la web y se entra al
 * login. Se muestra UNA sola vez por dispositivo.
 */
import React, { useRef, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Linking, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../i18n';
import { DASHBOARD_URL } from '../lib/config';
import { theme } from '../theme';

const WORDMARK = require('../../assets/logo-wordmark.png');

const BULLETS: { icon: keyof typeof Ionicons.glyphMap; key: string }[] = [
    { icon: 'chatbubbles-outline', key: 'welcome.b1' },
    { icon: 'sparkles-outline', key: 'welcome.b2' },
    { icon: 'people-outline', key: 'welcome.b3' },
];

export function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
    const { t } = useI18n();
    const anim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(anim, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [anim]);

    return (
        <SafeAreaView style={styles.container}>
            <Animated.View style={[styles.inner, {
                opacity: anim,
                transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
            }]}>
                <Image source={WORDMARK} style={styles.logo} resizeMode="contain" />
                <Text style={styles.tagline}>{t('welcome.tagline')}</Text>

                <View style={styles.bullets}>
                    {BULLETS.map((b) => (
                        <View key={b.key} style={styles.bulletRow}>
                            <View style={styles.bulletIcon}><Ionicons name={b.icon} size={17} color={theme.accent} /></View>
                            <Text style={styles.bulletText}>{t(b.key)}</Text>
                        </View>
                    ))}
                </View>

                <View style={{ flex: 1 }} />

                <TouchableOpacity style={styles.primaryBtn} onPress={onContinue}
                    accessibilityRole="button" accessibilityLabel={t('welcome.haveAccount')}>
                    <Text style={styles.primaryText}>{t('welcome.haveAccount')}</Text>
                </TouchableOpacity>

                {/* El alta vive en la web: acá solo se abre el navegador. */}
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => Linking.openURL(`${DASHBOARD_URL}/signup`)}
                    accessibilityRole="button" accessibilityLabel={t('welcome.createAccount')}>
                    <Ionicons name="open-outline" size={16} color={theme.accent} />
                    <Text style={styles.secondaryText}>{t('welcome.createAccount')}</Text>
                </TouchableOpacity>

                <Text style={styles.note}>{t('welcome.note')}</Text>
            </Animated.View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg },
    inner: { flex: 1, paddingHorizontal: 28, paddingTop: 48, paddingBottom: 28 },
    logo: { width: 200, height: 32, alignSelf: 'center' },
    tagline: { color: theme.textSecondary, fontSize: 15, textAlign: 'center', marginTop: 14, lineHeight: 21 },
    bullets: { marginTop: 40, gap: 18 },
    bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    bulletIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.accent + '1f', alignItems: 'center', justifyContent: 'center' },
    bulletText: { color: theme.text, fontSize: 14, flex: 1, lineHeight: 20 },
    primaryBtn: { backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 14, marginTop: 4 },
    secondaryText: { color: theme.accent, fontSize: 15, fontWeight: '600' },
    note: { color: theme.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 17, marginTop: 4 },
});
