import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n, SUPPORTED_LOCALES, LOCALE_LABELS } from '../i18n';
import { theme } from '../theme';

const STATUSES = [
    { key: 'online', color: theme.success },
    { key: 'away', color: theme.warning },
    { key: 'offline', color: theme.textSecondary },
];

function pct(v: any): string {
    const n = Number(v);
    return isFinite(n) ? `${Math.round(n * 100) / 100}%` : '—';
}

export function MoreScreen() {
    const { user, tenantId, logout } = useAuth();
    const toast = useToast();
    const { t, locale, setLocale } = useI18n();
    const [stats, setStats] = useState<any>(null);
    const [kpis, setKpis] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [availability, setAvailability] = useState('online');

    const load = useCallback(async () => {
        if (!tenantId) return;
        const end = new Date().toISOString();
        const start = new Date(Date.now() - 30 * 86400000).toISOString();
        try {
            const [r, k]: any[] = await Promise.all([
                api.getResolutionStats(tenantId, start, end),
                api.getOverviewKpis(tenantId, start, end),
            ]);
            if (r?.success) setStats(r.data?.summary || r.data);
            if (k?.success) setKpis(k.data);
        } catch {
            toast.error(t('common.loadError'));
        } finally {
            setLoading(false);
        }
    }, [tenantId, toast, t]);

    useEffect(() => { load(); }, [load]);

    const setStatus = async (s: string) => {
        if (!user?.id) return;
        const prev = availability;
        setAvailability(s); // optimista
        try {
            await api.setAvailability(user.id, s);
        } catch {
            setAvailability(prev); // rollback si falla
            toast.error('No se pudo cambiar tu disponibilidad.');
        }
    };

    const resolution = stats?.aiResolutionRate ?? stats?.resolutionRate ?? stats?.rate;
    const verified = stats?.verifiedResolutionRate ?? stats?.verifiedRate;
    const totalConvs = kpis?.totalConversations ?? kpis?.conversations ?? stats?.total;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
                <Text style={styles.h1}>{t('more.title')}</Text>

                {/* Availability */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>{t('more.availability')}</Text>
                    <View style={styles.statusRow}>
                        {STATUSES.map((s) => (
                            <TouchableOpacity key={s.key} onPress={() => setStatus(s.key)}
                                style={[styles.statusBtn, availability === s.key && { borderColor: s.color, backgroundColor: s.color + '1a' }]}>
                                <View style={[styles.statusDot, { backgroundColor: s.color }]} />
                                <Text style={[styles.statusText, availability === s.key && { color: theme.text }]}>{t(`more.status.${s.key}`)}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Analytics */}
                <Text style={styles.section}>{t('more.performance')}</Text>
                {loading ? (
                    <ActivityIndicator color={theme.accent} style={{ marginTop: 20 }} />
                ) : (
                    <View style={styles.kpiGrid}>
                        <Kpi icon="sparkles-outline" color={theme.accent} label={t('more.kpi.aiResolution')} value={pct(resolution)} />
                        <Kpi icon="shield-checkmark-outline" color={theme.success} label={t('more.kpi.verified')} value={pct(verified)} />
                        <Kpi icon="chatbubbles-outline" color="#3498db" label={t('more.kpi.conversations')} value={totalConvs != null ? String(totalConvs) : '—'} />
                        <Kpi icon="time-outline" color={theme.warning} label={t('more.kpi.avgMsgs')} value={stats?.avgMessagesToResolution != null ? String(stats.avgMessagesToResolution) : '—'} />
                    </View>
                )}

                {/* Language selector */}
                <View style={[styles.card, { marginTop: 20 }]}>
                    <Text style={styles.cardTitle}>{t('more.language')}</Text>
                    <View style={styles.statusRow}>
                        {SUPPORTED_LOCALES.map((l) => (
                            <TouchableOpacity key={l} onPress={() => setLocale(l)}
                                style={[styles.statusBtn, locale === l && { borderColor: theme.accent, backgroundColor: theme.accent + '1a' }]}>
                                <Text style={[styles.statusText, locale === l && { color: theme.text }]}>{LOCALE_LABELS[l]}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Account */}
                <View style={[styles.card, { marginTop: 20 }]}>
                    <Text style={styles.userName}>{user?.name || user?.email}</Text>
                    <Text style={styles.userMeta}>{user?.role}</Text>
                    <TouchableOpacity style={styles.logout} onPress={logout}>
                        <Ionicons name="log-out-outline" size={18} color={theme.danger} />
                        <Text style={styles.logoutText}>{t('more.logout')}</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

function Kpi({ icon, color, label, value }: { icon: any; color: string; label: string; value: string }) {
    return (
        <View style={styles.kpi}>
            <Ionicons name={icon} size={18} color={color} />
            <Text style={styles.kpiValue}>{value}</Text>
            <Text style={styles.kpiLabel}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    h1: { color: theme.text, fontSize: 22, fontWeight: '700', marginBottom: 16 },
    section: { color: theme.textSecondary, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },
    card: { backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 14 },
    cardTitle: { color: theme.text, fontWeight: '700', fontSize: 14, marginBottom: 12 },
    statusRow: { flexDirection: 'row', gap: 8 },
    statusBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.border },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { color: theme.textSecondary, fontSize: 13, fontWeight: '600' },
    kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    kpi: { width: '47%', backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 14 },
    kpiValue: { color: theme.text, fontSize: 22, fontWeight: '700', marginTop: 8 },
    kpiLabel: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
    userName: { color: theme.text, fontSize: 16, fontWeight: '600' },
    userMeta: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
    logout: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 14, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
    logoutText: { color: theme.danger, fontSize: 15, fontWeight: '600' },
});
