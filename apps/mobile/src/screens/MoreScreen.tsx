import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { api, requireApiSuccess } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n, SUPPORTED_LOCALES, LOCALE_LABELS } from '../i18n';
import { haptic } from '../lib/haptics';
import { ACCOUNT_DELETION_URL, PRIVACY_POLICY_URL } from '../lib/config';
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
    const navigation = useNavigation<any>();
    const { t, locale, setLocale } = useI18n();
    const [availability, setAvailability] = useState('online');
    const [localTasks, setLocalTasks] = useState<any[]>([]);

    // React Query: datos del agente (cache 2 min, refetch automático al volver).
    const { data: moreData, isLoading: loading, isError, refetch } = useQuery({
        queryKey: ['more-stats', tenantId, user?.id],
        queryFn: async () => {
            if (!tenantId) return null;
            const end = new Date().toISOString();
            const start = new Date(Date.now() - 30 * 86400000).toISOString();
            const [r, k, s, tk]: any[] = await Promise.all([
                api.getResolutionStats(tenantId, start, end),
                api.getOverviewKpis(tenantId, start, end),
                api.getAgentsStatus(tenantId),
                api.getTasks(tenantId, user?.id ? `assignedTo=${user.id}&status=pending` : 'status=pending'),
            ]);
            // Availability and tasks are the operational core of this screen:
            // if either fails, React Query must expose an error instead of
            // showing a fake "online" state or "no tasks".
            const statusResult: any = requireApiSuccess(s);
            const tasksResult: any = requireApiSuccess(tk);
            if (Array.isArray(statusResult.data) && user?.id) {
                const me = statusResult.data.find((a: any) => (a.userId || a.user_id || a.id || a.agentId) === user.id);
                if (me?.status) setAvailability(me.status);
            }
            return {
                stats: r?.success ? (r.data?.summary || r.data) : null,
                kpis: k?.success ? k.data : null,
                analyticsError: !r?.success || !k?.success,
                tasks: (Array.isArray(tasksResult.data) ? tasksResult.data : (tasksResult.data?.tasks || []))
                    .filter((x: any) => !['completed', 'done', 'closed'].includes(String(x.status || '').toLowerCase())),
            };
        },
        staleTime: 2 * 60 * 1000,
        enabled: !!tenantId,
        throwOnError: false,
    });

    const stats = moreData?.stats ?? null;
    const kpis = moreData?.kpis ?? null;

    // Sync query tasks → local state for optimistic mutations
    React.useEffect(() => {
        if (moreData?.tasks) setLocalTasks(moreData.tasks);
    }, [moreData?.tasks]);

    const completeTask = async (tk: any) => {
        if (!tenantId) return;
        haptic.tap();
        setLocalTasks((prev) => prev.filter((x) => x.id !== tk.id)); // optimistic
        try {
            const r: any = await api.updateTaskStatus(tenantId, tk.id, 'completed');
            if (!r?.success) throw new Error('fail');
            toast.success(t('crm.taskDone'));
        } catch {
            setLocalTasks((prev) => [tk, ...prev]); // rollback
            toast.error(t('crm.taskStatusError'));
        }
    };

    const setStatus = async (s: string) => {
        if (!user?.id) return;
        haptic.tap();
        const prev = availability;
        setAvailability(s); // optimista
        try {
            requireApiSuccess(await api.setAvailability(user.id, s));
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

    const openExternal = useCallback((url: string) => {
        haptic.tap();
        void Linking.openURL(url).catch(() => toast.error(t('more.openLinkError')));
    }, [t, toast]);

    const resolution = stats?.aiResolutionRate ?? stats?.resolutionRate ?? stats?.rate;
    const verified = stats?.verifiedResolutionRate ?? stats?.verifiedRate;
    const totalConvs = kpis?.totalConversations ?? kpis?.conversations ?? stats?.total;
    const coreLoadError = isError && !moreData;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
                <Text style={styles.h1}>{t('more.title')}</Text>

                {loading && !moreData ? (
                    <ActivityIndicator color={theme.accent} style={{ marginVertical: 28 }} />
                ) : coreLoadError ? (
                    <View style={styles.loadErrorCard}>
                        <Ionicons name="cloud-offline-outline" size={28} color={theme.warning} />
                        <Text style={styles.loadErrorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">{t('common.loadError')}</Text>
                        <TouchableOpacity
                            style={styles.retryBtn}
                            onPress={() => void refetch()}
                            accessibilityRole="button"
                            accessibilityLabel={t('common.retry')}
                        >
                            <Ionicons name="refresh" size={16} color="#fff" />
                            <Text style={styles.retryText}>{t('common.retry')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <>
                        {isError && (
                            <TouchableOpacity
                                style={styles.errorBanner}
                                onPress={() => void refetch()}
                                accessibilityRole="button"
                                accessibilityLabel={`${t('common.loadError')} ${t('common.retry')}`}
                            >
                                <Ionicons name="cloud-offline-outline" size={15} color={theme.warning} />
                                <Text style={styles.errorBannerText}>{t('common.loadError')}</Text>
                                <Text style={styles.errorBannerAction}>{t('common.retry')}</Text>
                            </TouchableOpacity>
                        )}
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
                            <Text style={styles.cardTitle}>{t('more.tasks')}{localTasks.length > 0 ? ` (${localTasks.length})` : ''}</Text>
                            {localTasks.length === 0 ? (
                                <Text style={styles.muted}>{t('more.noTasks')}</Text>
                            ) : localTasks.slice(0, 8).map((tk: any, i: number) => (
                                <TouchableOpacity key={tk.id || i} style={styles.taskRow} onPress={() => completeTask(tk)}
                                    accessibilityRole="checkbox" accessibilityState={{ checked: false }} accessibilityLabel={tk.title}>
                                    <Ionicons name="ellipse-outline" size={20} color={theme.textSecondary} />
                                    <Text style={styles.taskText} numberOfLines={1}>{tk.title}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </>
                )}

                {!loading && !coreLoadError && (
                    <>
                        {/* Analytics */}
                        <Text style={styles.section}>{t('more.performance')}</Text>
                        {moreData?.analyticsError ? (
                            <View style={styles.analyticsErrorCard}>
                                <Text style={styles.loadErrorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">{t('common.loadError')}</Text>
                                <TouchableOpacity onPress={() => void refetch()} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
                                    <Text style={styles.inlineRetryText}>{t('common.retry')}</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View style={styles.kpiGrid}>
                                <Kpi icon="sparkles-outline" color={theme.accent} label={t('more.kpi.aiResolution')} value={pct(resolution)} />
                                <Kpi icon="shield-checkmark-outline" color={theme.success} label={t('more.kpi.verified')} value={pct(verified)} />
                                <Kpi icon="chatbubbles-outline" color="#3498db" label={t('more.kpi.conversations')} value={totalConvs != null ? String(totalConvs) : '—'} />
                                <Kpi icon="time-outline" color={theme.warning} label={t('more.kpi.avgMsgs')} value={stats?.avgMessagesToResolution != null ? String(stats.avgMessagesToResolution) : '—'} />
                            </View>
                        )}
                    </>
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

                {/* Settings */}
                <Text style={[styles.section, { marginTop: 20 }]}>{t('more.settings')}</Text>
                <View style={styles.card}>
                    <TouchableOpacity
                        style={styles.settingsRow}
                        onPress={() => { haptic.tap(); navigation.navigate('NotificationPrefs'); }}
                        accessibilityRole="button"
                        accessibilityLabel={t('more.notifPrefs')}
                    >
                        <Ionicons name="notifications-outline" size={20} color={theme.accent} />
                        <Text style={[styles.rowLabel, { flex: 1, marginLeft: 12 }]}>{t('more.notifPrefs')}</Text>
                        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                    </TouchableOpacity>
                </View>

                {/* Account and legal controls required by Google Play. */}
                <Text style={[styles.section, { marginTop: 20 }]}>{t('more.account')}</Text>
                <View style={styles.card}>
                    <Text style={styles.userName}>{user?.name || user?.email}</Text>
                    <Text style={styles.userMeta}>{user?.role}</Text>

                    <TouchableOpacity
                        style={styles.legalRow}
                        onPress={() => openExternal(PRIVACY_POLICY_URL)}
                        accessibilityRole="link"
                        accessibilityLabel={t('more.privacyPolicy')}
                        accessibilityHint={t('more.opensBrowser')}
                    >
                        <Ionicons name="shield-checkmark-outline" size={20} color={theme.accent} />
                        <Text style={styles.legalLabel}>{t('more.privacyPolicy')}</Text>
                        <Ionicons name="open-outline" size={16} color={theme.textSecondary} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.legalRow}
                        onPress={() => openExternal(ACCOUNT_DELETION_URL)}
                        accessibilityRole="link"
                        accessibilityLabel={t('more.requestAccountDeletion')}
                        accessibilityHint={t('more.opensBrowser')}
                    >
                        <Ionicons name="trash-outline" size={20} color={theme.danger} />
                        <Text style={[styles.legalLabel, { color: theme.danger }]}>{t('more.requestAccountDeletion')}</Text>
                        <Ionicons name="open-outline" size={16} color={theme.textSecondary} />
                    </TouchableOpacity>

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
    loadErrorCard: { alignItems: 'center', gap: 10, backgroundColor: theme.bgCard, borderColor: theme.warning + '66', borderWidth: 1, borderRadius: 12, padding: 20 },
    loadErrorText: { color: theme.textSecondary, fontSize: 13, textAlign: 'center' },
    retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: theme.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
    retryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12, borderRadius: 10, backgroundColor: theme.warning + '18', paddingHorizontal: 12, paddingVertical: 9 },
    errorBannerText: { color: theme.warning, fontSize: 12, flex: 1 },
    errorBannerAction: { color: theme.warning, fontSize: 12, fontWeight: '700' },
    analyticsErrorCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, backgroundColor: theme.bgCard, borderColor: theme.warning + '66', borderWidth: 1, borderRadius: 12, padding: 14 },
    inlineRetryText: { color: theme.accent, fontSize: 13, fontWeight: '700' },
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
    settingsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
    rowLabel: { color: theme.text, fontSize: 14, fontWeight: '600' },
    userName: { color: theme.text, fontSize: 16, fontWeight: '600' },
    userMeta: { color: theme.textSecondary, fontSize: 13, marginTop: 2, marginBottom: 12 },
    legalRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
    legalLabel: { color: theme.text, fontSize: 14, fontWeight: '600', flex: 1 },
    logout: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 14, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
    logoutText: { color: theme.danger, fontSize: 15, fontWeight: '600' },
});
