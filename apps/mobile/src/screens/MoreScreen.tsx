import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n, SUPPORTED_LOCALES, LOCALE_LABELS } from '../i18n';
import { haptic } from '../lib/haptics';
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
    const [tasks, setTasks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [availability, setAvailability] = useState('online');

    const load = useCallback(async () => {
        if (!tenantId) return;
        const end = new Date().toISOString();
        const start = new Date(Date.now() - 30 * 86400000).toISOString();
        try {
            const [r, k, s, tk]: any[] = await Promise.all([
                api.getResolutionStats(tenantId, start, end),
                api.getOverviewKpis(tenantId, start, end),
                api.getAgentsStatus(tenantId),
                api.getTasks(tenantId, user?.id ? `assignedTo=${user.id}&status=pending` : 'status=pending'),
            ]);
            if (r?.success) setStats(r.data?.summary || r.data);
            if (k?.success) setKpis(k.data);
            // Reflect the agent's real current status instead of assuming "online".
            if (s?.success && Array.isArray(s.data) && user?.id) {
                const me = s.data.find((a: any) => (a.userId || a.user_id || a.id || a.agentId) === user.id);
                if (me?.status) setAvailability(me.status);
            }
            if (tk?.success) setTasks((Array.isArray(tk.data) ? tk.data : (tk.data?.tasks || [])).filter((x: any) => !['completed', 'done', 'closed'].includes(String(x.status || '').toLowerCase())));
        } catch {
            toast.error(t('common.loadError'));
        } finally {
            setLoading(false);
        }
    }, [tenantId, toast, t, user?.id]);

    const completeTask = async (tk: any) => {
        if (!tenantId) return;
        haptic.tap();
        setTasks((prev) => prev.filter((x) => x.id !== tk.id)); // optimistic remove from pending
        try {
            const r: any = await api.updateTaskStatus(tenantId, tk.id, 'completed');
            if (!r?.success) throw new Error('fail');
            toast.success(t('crm.taskDone'));
        } catch {
            setTasks((prev) => [tk, ...prev]); // rollback
            toast.error(t('crm.taskStatusError'));
        }
    };

    useEffect(() => { load(); }, [load]);

    const setStatus = async (s: string) => {
        if (!user?.id) return;
        haptic.tap();
        const prev = availability;
        setAvailability(s); // optimista
        try {
            await api.setAvailability(user.id, s);
        } catch {
            setAvailability(prev); // rollback si falla
            toast.error(t('more.availabilityError'));
        }
    };

    // Destructive: a stray tap shouldn't end the session (QW1).
    const confirmLogout = () => {
        Alert.alert(t('more.logoutConfirmTitle'), t('more.logoutConfirmMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('more.logout'), style: 'destructive', onPress: () => logout() },
        ]);
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
                                accessibilityRole="button" accessibilityState={{ selected: availability === s.key }}
                                accessibilityLabel={t(`more.status.${s.key}`)}
                                style={[styles.statusBtn, availability === s.key && { borderColor: s.color, backgroundColor: s.color + '1a' }]}>
                                <View style={[styles.statusDot, { backgroundColor: s.color }]} />
                                <Text style={[styles.statusText, availability === s.key && { color: theme.text }]}>{t(`more.status.${s.key}`)}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* My tasks */}
                <View style={[styles.card, { marginTop: 20 }]}>
                    <Text style={styles.cardTitle}>{t('more.tasks')}{tasks.length > 0 ? ` (${tasks.length})` : ''}</Text>
                    {tasks.length === 0 ? (
                        <Text style={styles.muted}>{t('more.noTasks')}</Text>
                    ) : tasks.slice(0, 8).map((tk: any, i: number) => (
                        <TouchableOpacity key={tk.id || i} style={styles.taskRow} onPress={() => completeTask(tk)}
                            accessibilityRole="checkbox" accessibilityState={{ checked: false }} accessibilityLabel={tk.title}>
                            <Ionicons name="ellipse-outline" size={20} color={theme.textSecondary} />
                            <Text style={styles.taskText} numberOfLines={1}>{tk.title}</Text>
                        </TouchableOpacity>
                    ))}
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
                            <TouchableOpacity key={l} onPress={() => { haptic.tap(); setLocale(l); }}
                                accessibilityRole="button" accessibilityState={{ selected: locale === l }}
                                accessibilityLabel={LOCALE_LABELS[l]}
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
                    <TouchableOpacity style={styles.logout} onPress={confirmLogout}
                        accessibilityRole="button" accessibilityLabel={t('more.logout')}>
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
    muted: { color: theme.textSecondary, fontSize: 13 },
    taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
    taskText: { color: theme.text, fontSize: 14, flex: 1 },
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
