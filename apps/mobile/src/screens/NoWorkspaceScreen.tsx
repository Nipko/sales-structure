/**
 * Cuenta válida pero SIN empresa (tenantId null): puede pasar si alguien se
 * registró en la web y abandonó el wizard antes de crear la empresa.
 *
 * Antes, ese usuario entraba a la consola y la veía permanentemente vacía (cada
 * pantalla corta con `if (!tenantId) return`) sin explicación ni salida. Acá se
 * le dice qué falta y se lo manda a terminarlo en la web.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n';
import { DASHBOARD_URL } from '../lib/config';
import { theme } from '../theme';

const WORDMARK = require('../../assets/logo-wordmark.png');

export function NoWorkspaceScreen() {
    const { logout, user } = useAuth();
    const { t } = useI18n();

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.inner}>
                <Image source={WORDMARK} style={styles.logo} resizeMode="contain" />

                <View style={styles.iconWrap}>
                    <Ionicons name="business-outline" size={34} color={theme.accent} />
                </View>

                <Text style={styles.title}>{t('noWorkspace.title')}</Text>
                <Text style={styles.body}>{t('noWorkspace.body')}</Text>
                {!!user?.email && <Text style={styles.email}>{user.email}</Text>}

                <TouchableOpacity style={styles.primaryBtn} onPress={() => Linking.openURL(`${DASHBOARD_URL}/onboarding`)}
                    accessibilityRole="button" accessibilityLabel={t('noWorkspace.finish')}>
                    <Ionicons name="open-outline" size={17} color="#fff" />
                    <Text style={styles.primaryText}>{t('noWorkspace.finish')}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.linkBtn} onPress={logout} accessibilityRole="button">
                    <Text style={styles.link}>{t('more.logout')}</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg },
    inner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 4 },
    logo: { width: 170, height: 28, marginBottom: 32 },
    iconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.accent + '1f', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
    title: { color: theme.text, fontSize: 19, fontWeight: '700', textAlign: 'center' },
    body: { color: theme.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 10 },
    email: { color: theme.textSecondary, fontSize: 13, marginTop: 10, fontWeight: '600' },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 28, alignSelf: 'stretch' },
    primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    linkBtn: { paddingVertical: 16 },
    link: { color: theme.textSecondary, fontSize: 14 },
});
