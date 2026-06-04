import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Alert, Modal, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { haptic } from '../lib/haptics';
import { theme } from '../theme';

interface Appt {
    id: string;
    start_at?: string; startAt?: string;
    end_at?: string; endAt?: string;
    status?: string;
    service_name?: string; serviceName?: string;
    service_id?: string; serviceId?: string;
    customer_name?: string; contact_name?: string; customerName?: string;
    location?: string; notes?: string;
    assigned_name?: string; assignedName?: string;
}
interface Slot { time: string; endTime: string; agentId?: string; agentName?: string }

const STATUS_COLOR: Record<string, string> = {
    confirmed: theme.success, pending: theme.warning, scheduled: theme.accent,
    completed: theme.textSecondary, cancelled: theme.danger, no_show: theme.danger,
};

function start(a: Appt): Date | null { const s = a.start_at || a.startAt; return s ? new Date(s) : null; }
function customer(a: Appt): string { return a.customer_name || a.contact_name || a.customerName || 'Cliente'; }
function service(a: Appt): string { return a.service_name || a.serviceName || 'Cita'; }
const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function AppointmentsScreen() {
    const { tenantId } = useAuth();
    const toast = useToast();
    const { t } = useI18n();
    const insets = useSafeAreaInsets();
    const [items, setItems] = useState<Appt[]>([]);
    const [services, setServices] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [busy, setBusy] = useState('');

    // Detail / reschedule sheet
    const [selected, setSelected] = useState<Appt | null>(null);
    const [rDate, setRDate] = useState('');
    const [slots, setSlots] = useState<Slot[]>([]);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [rescheduling, setRescheduling] = useState(false);

    // Create-appointment sheet
    const [createOpen, setCreateOpen] = useState(false);
    const [cServiceId, setCServiceId] = useState('');
    const [cDate, setCDate] = useState('');
    const [cSlots, setCSlots] = useState<Slot[]>([]);
    const [cSlotsLoading, setCSlotsLoading] = useState(false);
    const [cSlot, setCSlot] = useState<Slot | null>(null);
    const [cNotes, setCNotes] = useState('');
    const [cContactSearch, setCContactSearch] = useState('');
    const [cContactResults, setCContactResults] = useState<any[]>([]);
    const [cContact, setCContact] = useState<{ id: string; name: string } | null>(null);
    const [creating, setCreating] = useState(false);

    const load = useCallback(async () => {
        if (!tenantId) return;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const horizon = new Date(today.getTime() + 14 * 86400000);
        const params = `start=${today.toISOString()}&end=${horizon.toISOString()}`;
        const res: any = await api.getAppointments(tenantId, params);
        const data = res?.success ? (Array.isArray(res.data) ? res.data : res.data?.appointments || []) : [];
        const upcoming = data
            .filter((a: Appt) => { const s = start(a); return s && s >= today && a.status !== 'cancelled'; })
            .sort((a: Appt, b: Appt) => (start(a)!.getTime()) - (start(b)!.getTime()));
        setItems(upcoming);
        setLoading(false); setRefreshing(false);
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (!tenantId) return;
        api.getBookableServices(tenantId).then((r: any) => { if (r?.success && Array.isArray(r.data)) setServices(r.data); }).catch(() => {});
    }, [tenantId]);

    // Debounced lead search for the (optional) contact picker when creating.
    useEffect(() => {
        if (!tenantId || !createOpen) return;
        const q = cContactSearch.trim();
        if (q.length < 2) { setCContactResults([]); return; }
        const tm = setTimeout(async () => {
            try {
                const r: any = await api.getLeads(tenantId, `search=${encodeURIComponent(q)}&limit=8`);
                if (r?.success) setCContactResults(Array.isArray(r.data) ? r.data : []);
            } catch { /* ignore */ }
        }, 350);
        return () => clearTimeout(tm);
    }, [cContactSearch, tenantId, createOpen]);

    const confirm = async (a: Appt) => {
        if (!tenantId) return;
        setBusy(a.id);
        try { await api.updateAppointment(tenantId, a.id, { status: 'confirmed' }); toast.success(t('citas.confirmed')); await load(); }
        catch { toast.error(t('citas.confirmError')); }
        finally { setBusy(''); }
    };
    const cancel = (a: Appt) => {
        Alert.alert(t('citas.cancelTitle'), t('citas.cancelConfirm', { name: customer(a) }), [
            { text: t('citas.no'), style: 'cancel' },
            { text: t('citas.yesCancel'), style: 'destructive', onPress: async () => {
                if (!tenantId) return;
                setBusy(a.id);
                try { await api.cancelAppointment(tenantId, a.id, 'Cancelada desde la app'); toast.success(t('citas.cancelled')); setSelected(null); await load(); }
                catch { toast.error(t('citas.cancelError')); }
                finally { setBusy(''); }
            } },
        ]);
    };

    // Resolve the appointment's service id (needed for slot lookup).
    const serviceIdFor = (a: Appt): string | null => {
        if (a.service_id || a.serviceId) return a.service_id || a.serviceId!;
        const name = service(a).toLowerCase();
        const match = services.find((s) => String(s.name || '').toLowerCase() === name);
        return match?.id || null;
    };

    const openDetail = (a: Appt) => { haptic.tap(); setSelected(a); setRDate(''); setSlots([]); };

    const pickDate = async (dateStr: string) => {
        if (!tenantId || !selected) return;
        const sid = serviceIdFor(selected);
        setRDate(dateStr); setSlots([]);
        if (!sid) { toast.error(t('citas.serviceUnknown')); return; }
        setSlotsLoading(true);
        try {
            const r: any = await api.getBookableSlots(tenantId, dateStr, sid);
            const list = r?.data?.slots || r?.data || [];
            setSlots(Array.isArray(list) ? list : []);
        } catch { toast.error(t('citas.slotsError')); }
        finally { setSlotsLoading(false); }
    };

    const chooseSlot = async (slot: Slot) => {
        if (!tenantId || !selected || !rDate) return;
        const startAt = new Date(`${rDate}T${slot.time}:00`).toISOString();
        const endAt = new Date(`${rDate}T${(slot.endTime || slot.time)}:00`).toISOString();
        setRescheduling(true);
        try {
            const r: any = await api.updateAppointment(tenantId, selected.id, { startAt, endAt });
            if (!r?.success) throw new Error('fail');
            toast.success(t('citas.rescheduled'));
            setSelected(null);
            await load();
        } catch { toast.error(t('citas.rescheduleError')); }
        finally { setRescheduling(false); }
    };

    const openCreate = () => {
        haptic.tap();
        setCServiceId(services[0]?.id || ''); setCDate(''); setCSlots([]); setCSlot(null);
        setCNotes(''); setCContactSearch(''); setCContactResults([]); setCContact(null);
        setCreateOpen(true);
    };
    const cPickDate = async (dateStr: string) => {
        if (!tenantId || !cServiceId) return;
        setCDate(dateStr); setCSlots([]); setCSlot(null);
        setCSlotsLoading(true);
        try {
            const r: any = await api.getBookableSlots(tenantId, dateStr, cServiceId);
            const list = r?.data?.slots || r?.data || [];
            setCSlots(Array.isArray(list) ? list : []);
        } catch { toast.error(t('citas.slotsError')); }
        finally { setCSlotsLoading(false); }
    };
    const createAppt = async () => {
        if (!tenantId || !cServiceId || !cDate || !cSlot) return;
        const svc = services.find((s) => s.id === cServiceId);
        const startAt = new Date(`${cDate}T${cSlot.time}:00`).toISOString();
        const endAt = new Date(`${cDate}T${(cSlot.endTime || cSlot.time)}:00`).toISOString();
        setCreating(true);
        try {
            const payload: Record<string, any> = { serviceName: svc?.name, serviceId: cServiceId, startAt, endAt };
            if (cSlot.agentId) payload.assignedTo = cSlot.agentId;
            if (cContact) payload.contactId = cContact.id;
            if (cNotes.trim()) payload.notes = cNotes.trim();
            const r: any = await api.createAppointment(tenantId, payload);
            if (!r?.success) throw new Error('fail');
            toast.success(t('citas.created'));
            setCreateOpen(false);
            await load();
        } catch { toast.error(t('citas.createError')); }
        finally { setCreating(false); }
    };

    if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></SafeAreaView>;

    const todayStr = new Date().toDateString();
    const dateChips = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; });

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
                        <TouchableOpacity style={styles.card} onPress={() => openDetail(item)}
                            accessibilityRole="button" accessibilityLabel={`${service(item)} · ${customer(item)}`} accessibilityHint={t('citas.tapToManage')}>
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
                                    <TouchableOpacity onPress={() => confirm(item)} disabled={busy === item.id}
                                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.apptBtn}
                                        accessibilityRole="button" accessibilityLabel={t('citas.confirmA11y', { name: customer(item) })}>
                                        <Ionicons name="checkmark-circle-outline" size={26} color={theme.success} />
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity onPress={() => cancel(item)} disabled={busy === item.id}
                                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.apptBtn}
                                    accessibilityRole="button" accessibilityLabel={t('citas.cancelA11y', { name: customer(item) })}>
                                    <Ionicons name="close-circle-outline" size={26} color={theme.danger} />
                                </TouchableOpacity>
                            </View>
                        </TouchableOpacity>
                    );
                }}
            />

            {/* Create-appointment FAB */}
            <TouchableOpacity style={styles.fab} onPress={openCreate} accessibilityRole="button" accessibilityLabel={t('citas.new')}>
                <Ionicons name="add" size={28} color="#fff" />
            </TouchableOpacity>

            {/* Detail + reschedule sheet */}
            <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
                <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSelected(null)}>
                    <View style={styles.sheet} onStartShouldSetResponder={() => true}>
                        {selected && (
                            <ScrollView>
                                <Text style={styles.sheetTitle}>{service(selected)}</Text>
                                <Row label={t('citas.field.customer')} value={customer(selected)} />
                                <Row label={t('citas.field.when')} value={start(selected)?.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} />
                                <Row label={t('citas.field.status')} value={selected.status} />
                                <Row label={t('citas.field.assigned')} value={selected.assigned_name || selected.assignedName} />
                                <Row label={t('citas.field.location')} value={selected.location} />
                                <Row label={t('citas.field.notes')} value={selected.notes} />

                                {/* Reschedule */}
                                <Text style={styles.sectionLabel}>{t('citas.reschedule')}</Text>
                                <Text style={styles.hint}>{t('citas.pickDate')}</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }} contentContainerStyle={{ gap: 8 }}>
                                    {dateChips.map((d) => {
                                        const ds = localDate(d);
                                        const on = ds === rDate;
                                        return (
                                            <TouchableOpacity key={ds} onPress={() => pickDate(ds)}
                                                style={[styles.dateChip, on && { backgroundColor: theme.accent, borderColor: theme.accent }]}>
                                                <Text style={[styles.dateChipTop, on && { color: '#fff' }]}>{d.toLocaleDateString([], { weekday: 'short' })}</Text>
                                                <Text style={[styles.dateChipDay, on && { color: '#fff' }]}>{d.getDate()}</Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </ScrollView>

                                {!!rDate && (
                                    <>
                                        <Text style={styles.hint}>{t('citas.pickSlot')}</Text>
                                        {slotsLoading ? (
                                            <ActivityIndicator color={theme.accent} style={{ marginTop: 10 }} />
                                        ) : slots.length === 0 ? (
                                            <Text style={[styles.empty, { marginTop: 8 }]}>{t('citas.noSlots')}</Text>
                                        ) : (
                                            <View style={styles.slotGrid}>
                                                {slots.map((sl, i) => (
                                                    <TouchableOpacity key={i} style={styles.slotChip} disabled={rescheduling} onPress={() => chooseSlot(sl)}>
                                                        <Text style={styles.slotText}>{sl.time}</Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                        )}
                                    </>
                                )}

                                {/* Quick actions */}
                                <View style={styles.sheetActions}>
                                    {selected.status !== 'confirmed' && (
                                        <TouchableOpacity style={[styles.sheetBtn, { borderColor: theme.success }]} onPress={() => confirm(selected)} disabled={!!busy}>
                                            <Ionicons name="checkmark-circle-outline" size={18} color={theme.success} />
                                            <Text style={[styles.sheetBtnText, { color: theme.success }]}>{t('citas.confirm')}</Text>
                                        </TouchableOpacity>
                                    )}
                                    <TouchableOpacity style={[styles.sheetBtn, { borderColor: theme.danger }]} onPress={() => cancel(selected)} disabled={!!busy}>
                                        <Ionicons name="close-circle-outline" size={18} color={theme.danger} />
                                        <Text style={[styles.sheetBtnText, { color: theme.danger }]}>{t('citas.cancelBtn')}</Text>
                                    </TouchableOpacity>
                                </View>
                                {rescheduling && <ActivityIndicator color={theme.accent} style={{ marginTop: 8 }} />}
                            </ScrollView>
                        )}
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* Create-appointment sheet */}
            <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)} statusBarTranslucent>
                <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
                    <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setCreateOpen(false)}>
                        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onStartShouldSetResponder={() => true}>
                            <ScrollView keyboardShouldPersistTaps="handled">
                                <Text style={styles.sheetTitle}>{t('citas.new')}</Text>

                                <Text style={styles.sectionLabel}>{t('citas.pickService')}</Text>
                                {services.length === 0 ? (
                                    <Text style={styles.empty}>{t('citas.noServices')}</Text>
                                ) : (
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                                        {services.map((s) => {
                                            const on = s.id === cServiceId;
                                            return (
                                                <TouchableOpacity key={s.id} onPress={() => { setCServiceId(s.id); setCDate(''); setCSlots([]); setCSlot(null); }}
                                                    style={[styles.svcChip, on && { backgroundColor: (s.color || theme.accent) + '22', borderColor: s.color || theme.accent }]}>
                                                    <Text style={[styles.svcChipText, on && { color: theme.text }]}>{s.name}</Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </ScrollView>
                                )}

                                <Text style={styles.sectionLabel}>{t('citas.contactOptional')}</Text>
                                {cContact ? (
                                    <View style={styles.selectedContact}>
                                        <Text style={styles.selectedContactText}>{cContact.name}</Text>
                                        <TouchableOpacity onPress={() => { setCContact(null); setCContactSearch(''); }}><Ionicons name="close-circle" size={18} color={theme.textSecondary} /></TouchableOpacity>
                                    </View>
                                ) : (
                                    <>
                                        <TextInput style={styles.input} placeholder={t('citas.searchContact')} placeholderTextColor={theme.textSecondary} value={cContactSearch} onChangeText={setCContactSearch} />
                                        {cContactResults.map((l) => {
                                            const nm = `${l.first_name || ''} ${l.last_name || ''}`.trim() || l.name || l.phone || 'Lead';
                                            return (
                                                <TouchableOpacity key={l.id} style={styles.contactRow} onPress={() => { setCContact({ id: l.contact_id || l.customer_profile_id || l.id, name: nm }); setCContactResults([]); }}>
                                                    <Text style={styles.contactName}>{nm}</Text>
                                                    {!!l.phone && <Text style={styles.contactSub}>{l.phone}</Text>}
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </>
                                )}

                                <Text style={styles.sectionLabel}>{t('citas.pickDate')}</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }} contentContainerStyle={{ gap: 8 }}>
                                    {dateChips.map((d) => {
                                        const ds = localDate(d); const on = ds === cDate;
                                        return (
                                            <TouchableOpacity key={ds} onPress={() => cPickDate(ds)} disabled={!cServiceId}
                                                style={[styles.dateChip, on && { backgroundColor: theme.accent, borderColor: theme.accent }, !cServiceId && { opacity: 0.4 }]}>
                                                <Text style={[styles.dateChipTop, on && { color: '#fff' }]}>{d.toLocaleDateString([], { weekday: 'short' })}</Text>
                                                <Text style={[styles.dateChipDay, on && { color: '#fff' }]}>{d.getDate()}</Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </ScrollView>

                                {!!cDate && (cSlotsLoading ? (
                                    <ActivityIndicator color={theme.accent} style={{ marginTop: 8 }} />
                                ) : cSlots.length === 0 ? (
                                    <Text style={[styles.empty, { marginTop: 8 }]}>{t('citas.noSlots')}</Text>
                                ) : (
                                    <View style={styles.slotGrid}>
                                        {cSlots.map((sl, i) => {
                                            const on = cSlot?.time === sl.time;
                                            return (
                                                <TouchableOpacity key={i} onPress={() => setCSlot(sl)} style={[styles.slotChip, on && { backgroundColor: theme.accent }]}>
                                                    <Text style={[styles.slotText, on && { color: '#fff' }]}>{sl.time}</Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                ))}

                                <TextInput style={[styles.input, { minHeight: 60, marginTop: 14, textAlignVertical: 'top' }]} placeholder={t('citas.notesOptional')} placeholderTextColor={theme.textSecondary} value={cNotes} onChangeText={setCNotes} multiline />

                                <TouchableOpacity style={[styles.primaryBtn, (creating || !cSlot) && { opacity: 0.5 }]} onPress={createAppt} disabled={creating || !cSlot}>
                                    {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{t('citas.create')}</Text>}
                                </TouchableOpacity>
                            </ScrollView>
                        </View>
                    </TouchableOpacity>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

function Row({ label, value }: { label: string; value?: string }) {
    if (!value) return null;
    return (
        <View style={styles.kv}>
            <Text style={styles.k}>{label}</Text>
            <Text style={styles.v}>{value}</Text>
        </View>
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
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.bgCard, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: '85%' },
    sheetTitle: { color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 10 },
    kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    k: { color: theme.textSecondary, fontSize: 14 },
    v: { color: theme.text, fontSize: 14, fontWeight: '500', maxWidth: '62%', textAlign: 'right' },
    sectionLabel: { color: theme.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 4 },
    hint: { color: theme.textSecondary, fontSize: 13, marginTop: 6 },
    dateChip: { width: 52, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg, alignItems: 'center' },
    dateChipTop: { color: theme.textSecondary, fontSize: 11 },
    dateChipDay: { color: theme.text, fontSize: 16, fontWeight: '700', marginTop: 2 },
    slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    slotChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: theme.accent, backgroundColor: theme.accent + '14' },
    slotText: { color: theme.accent, fontSize: 14, fontWeight: '700' },
    sheetActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
    sheetBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 10, borderWidth: 1 },
    sheetBtnText: { fontSize: 14, fontWeight: '600' },
    fab: { position: 'absolute', right: 18, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
    input: { backgroundColor: theme.bg, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: theme.text, fontSize: 15 },
    svcChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg },
    svcChipText: { color: theme.textSecondary, fontSize: 13, fontWeight: '600' },
    selectedContact: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.accent + '1a', borderColor: theme.accent, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
    selectedContactText: { color: theme.text, fontSize: 14, fontWeight: '600' },
    contactRow: { paddingVertical: 10, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    contactName: { color: theme.text, fontSize: 14, fontWeight: '500' },
    contactSub: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
    primaryBtn: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
    primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
