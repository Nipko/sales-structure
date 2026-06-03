import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { theme } from '../theme';

interface Appt {
    id: string;
    start_at?: string;
    startAt?: string;
    status?: string;
    service_name?: string;
    serviceName?: string;
    customer_name?: string;
    contact_name?: string;
    customerName?: string;
}

const STATUS_COLOR: Record<string, string> = {
    confirmed: theme.success, pending: theme.warning, scheduled: theme.accent,
    completed: theme.textSecondary, cancelled: theme.danger, no_show: theme.danger,
};

function start(a: Appt): Date | null {
    const s = a.start_at || a.startAt;
    return s ? new Date(s) : null;
}
function customer(a: Appt): string { return a.customer_name || a.contact_name || a.customerName || 'Cliente'; }
function service(a: Appt): string { return a.service_name || a.serviceName || 'Cita'; }

export function AppointmentsScreen() {
    const { tenantId } = useAuth();
    const toast = useToast();
    const { t } = useI18n();
    const [items, setItems] = useState<Appt[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        if (!tenantId) return;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const horizon = new Date(today.getTime() + 14 * 86400000);
        const params = `start=${today.toISOString()}&end=${horizon.toISOString()}`;
        const res: any = await api.getAppointments(tenantId, params);
        const data = res?.success ? (Array.isArray(res.data) ? res.data : res.data?.appointments || []) : [];
        // upcoming, not cancelled, sorted
        const upcoming = data
            .filter((a: Appt) => { const s = start(a); return s && s >= today && a.status !== 'cancelled'; })
            .sort((a: Appt, b: Appt) => (start(a)!.getTime()) - (start(b)!.getTime()));
        setItems(upcoming);
        setLoading(false); setRefreshing(false);
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    const confirm = async (a: Appt) => {
        if (!tenantId) return;
        setBusy(a.id);
        try {
            await api.updateAppointment(tenantId, a.id, { status: 'confirmed' });
            toast.success(t('citas.confirmed'));
            await load();
        } catch {
            toast.error(t('citas.confirmError'));
        } finally { setBusy(''); }
    };
    const cancel = (a: Appt) => {
        Alert.alert(t('citas.cancelTitle'), t('citas.cancelConfirm', { name: customer(a) }), [
            { text: t('citas.no'), style: 'cancel' },
            {
                text: t('citas.yesCancel'), style: 'destructive', onPress: async () => {
                    if (!tenantId) return;
                    setBusy(a.id);
                    try {
                        await api.cancelAppointment(tenantId, a.id, 'Cancelada desde la app');
                        toast.success(t('citas.cancelled'));
                        await load();
                    } catch {
                        toast.error(t('citas.cancelError'));
                    } finally { setBusy(''); }
                },
            },
        ]);
    };

    if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></SafeAreaView>;

    const todayStr = new Date().toDateString();

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>
            <Text style={styles.h1}>{t('citas.title')}</Text>
            <FlatList
                data={items}
                keyExtractor={(a) => a.id}
                contentContainerStyle={{ paddingBottom: 24 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
                ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>{t('citas.empty')}</Text></View>}
                renderItem={({ item }) => {
                    const s = start(item);
                    const isToday = s && s.toDateString() === todayStr;
                    const time = s ? s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    const day = s ? (isToday ? t('citas.today') : s.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })) : '';
                    return (
                        <View style={styles.card}>
                            <View style={styles.timeCol}>
                                <Text style={[styles.day, isToday && { color: theme.accent }]}>{day}</Text>
                                <Text style={styles.time}>{time}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.svc}>{service(item)}</Text>
                                <Text style={styles.cust}>{customer(item)}</Text>
                                <View style={styles.badgeRow}>
                                    <View style={[styles.badge, { backgroundColor: (STATUS_COLOR[item.status || ''] || theme.textSecondary) + '22' }]}>
                                        <Text style={[styles.badgeText, { color: STATUS_COLOR[item.status || ''] || theme.textSecondary }]}>{item.status || '—'}</Text>
                                    </View>
                                </View>
                            </View>
                            <View style={styles.apptActions}>
                                {item.status !== 'confirmed' && (
                                    <TouchableOpacity
                                        onPress={() => confirm(item)}
                                        disabled={busy === item.id}
                                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                        style={styles.apptBtn}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('citas.confirmA11y', { name: customer(item) })}
                                    >
                                        <Ionicons name="checkmark-circle-outline" size={26} color={theme.success} />
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                    onPress={() => cancel(item)}
                                    disabled={busy === item.id}
                                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                    style={styles.apptBtn}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('citas.cancelA11y', { name: customer(item) })}
                                >
                                    <Ionicons name="close-circle-outline" size={26} color={theme.danger} />
                                </TouchableOpacity>
                            </View>
                        </View>
                    );
                }}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, backgroundColor: theme.bg },
    empty: { color: theme.textSecondary },
    h1: { color: theme.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 12 },
    card: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginVertical: 5, padding: 12, borderRadius: 12, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, gap: 12 },
    timeCol: { width: 64, alignItems: 'center' },
    day: { color: theme.textSecondary, fontSize: 12 },
    time: { color: theme.text, fontSize: 16, fontWeight: '700', marginTop: 2 },
    svc: { color: theme.text, fontSize: 15, fontWeight: '600' },
    cust: { color: theme.textSecondary, fontSize: 13, marginTop: 1 },
    badgeRow: { flexDirection: 'row', marginTop: 6 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
    badgeText: { fontSize: 11, fontWeight: '600' },
    apptActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    apptBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
