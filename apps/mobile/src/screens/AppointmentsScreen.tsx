import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Alert, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n, type Locale } from '../i18n';
import { PressableScale } from '../components/PressableScale';
import { Modal } from '../components/AppModal';
import { haptic } from '../lib/haptics';
import { theme } from '../theme';
import { collectApiPages } from '../lib/pagination';
import {
    resolveAppointmentSubjectKind,
    validTenantContactId,
    type AppointmentSubjectKind,
} from '../lib/operationContactIntegrity';
import { resolveVerticalWorkspace, resolveVerticalWorkspaceLabel } from '../lib/verticalWorkspace';

interface Appt {
    id: string;
    start_at?: string; startAt?: string;
    end_at?: string; endAt?: string;
    status?: string;
    service_name?: string; serviceName?: string;
    service_id?: string; serviceId?: string;
    customer_name?: string; contact_name?: string; customerName?: string; contactName?: string;
    location?: string; notes?: string;
    assigned_name?: string; assignedName?: string;
    metadata?: Record<string, unknown>;
}
interface Slot { time: string; endTime: string; agentId?: string; agentName?: string }
type SubjectKind = AppointmentSubjectKind;
type CreateSubjectKind = SubjectKind;
interface SubjectOption { id: string; name: string; detail?: string; contactId?: string; contactName?: string }
type Translator = (key: string, params?: Record<string, string | number>) => string;

const STATUS_COLOR: Record<string, string> = {
    confirmed: theme.success, pending: theme.warning, scheduled: theme.accent,
    completed: theme.textSecondary, cancelled: theme.danger, no_show: theme.danger,
};
const TERMINAL_STATUSES = new Set(['completed', 'no_show', 'cancelled']);

function start(a: Appt): Date | null { const s = a.start_at || a.startAt; return s ? new Date(s) : null; }
function customer(a: Appt, fallback: string): string { return a.customer_name || a.contact_name || a.contactName || a.customerName || fallback; }
function service(a: Appt, fallback: string): string { return a.service_name || a.serviceName || fallback; }
function normalizedStatus(a: Appt): string { return String(a.status || '').trim().toLowerCase(); }
function isTerminal(a: Appt): boolean { return TERMINAL_STATUSES.has(normalizedStatus(a)); }
const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const LOCALE_TAG: Record<Locale, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };
const SUBJECT_META_KEY: Record<SubjectKind, 'listingId' | 'petId' | 'vehicleId'> = {
    listing: 'listingId', pet: 'petId', vehicle: 'vehicleId',
};
const SUBJECT_LABEL_KEY: Record<SubjectKind, string> = {
    listing: 'citas.subject.listing', pet: 'citas.subject.pet', vehicle: 'citas.subject.vehicle',
};

function statusLabel(t: Translator, status?: string): string {
    const normalized = String(status || '').trim().toLowerCase();
    if (!normalized) return t('ops.status.unknown');
    const key = `ops.status.${normalized}`;
    const translated = t(key);
    return translated === key ? t('ops.status.unknown') : translated;
}

function isValidFutureDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const [, year, month, day] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (
        parsed.getFullYear() !== Number(year)
        || parsed.getMonth() !== Number(month) - 1
        || parsed.getDate() !== Number(day)
    ) return false;
    parsed.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return parsed >= today;
}

function quickDate(days: number): string {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return localDate(date);
}
// Build a NAIVE tenant-local timestamp from a YYYY-MM-DD date + "H:MM" slot.
// El backend guarda hora-pared local SIN zona (normalizeNaive descarta el
// offset): el round-trip por Date.toISOString() convertía a UTC y cada cita
// creada desde el móvil quedaba corrida por el offset del teléfono (Bogotá:
// 5 horas tarde). Mismo contrato que usa el dashboard.
function toIsoAt(dateStr: string, hhmm: string): string {
    const [h, m] = String(hhmm || '0:0').split(':');
    return `${dateStr}T${pad(Number(h))}:${pad(Number(m || 0))}:00`;
}

function slotsFromResponse(response: any): Slot[] {
    if (!response?.success) throw new Error(response?.error || 'slots_failed');
    const candidate = Array.isArray(response.data) ? response.data : response.data?.slots;
    if (!Array.isArray(candidate)) throw new Error('invalid_slots_response');
    return candidate;
}

export function AppointmentsScreen() {
    const { tenantId, verticalConfig } = useAuth();
    const toast = useToast();
    const { t, locale } = useI18n();
    const insets = useSafeAreaInsets();
    const [services, setServices] = useState<any[]>([]);
    const [servicesLoading, setServicesLoading] = useState(false);
    const [servicesError, setServicesError] = useState(false);
    const [servicesRetryKey, setServicesRetryKey] = useState(0);
    const [busy, setBusy] = useState('');

    const industry = String(verticalConfig?.industry || '').toLowerCase();
    const subType = String(verticalConfig?.subType || '').toLowerCase();
    // A dealership vehicle is inventory context for the canonical appointment
    // (for example, a test drive), not a parallel booking model. Workshops stay
    // out because /vehicles is stock, not the customer's vehicle.
    const subjectKind = useMemo(
        () => resolveAppointmentSubjectKind(industry, subType),
        [industry, subType],
    );
    const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
    const [subjectsLoading, setSubjectsLoading] = useState(false);

    // Same resolution the bottom tab uses, so the header can't contradict the
    // tab that opened it (see resolveVerticalWorkspaceLabel).
    const verticalTitle = resolveVerticalWorkspaceLabel({
        verticalConfig,
        workspace: resolveVerticalWorkspace(verticalConfig || {}),
        locale,
        t,
    });

    // Detail / reschedule sheet
    const [selected, setSelected] = useState<Appt | null>(null);
    const [rDate, setRDate] = useState('');
    const [rDateInput, setRDateInput] = useState('');
    const [slots, setSlots] = useState<Slot[]>([]);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [slotsError, setSlotsError] = useState(false);
    const [rescheduling, setRescheduling] = useState(false);

    // Create-appointment sheet
    const [createOpen, setCreateOpen] = useState(false);
    const [cServiceId, setCServiceId] = useState('');
    const [cDate, setCDate] = useState('');
    const [cDateInput, setCDateInput] = useState('');
    const [cSlots, setCSlots] = useState<Slot[]>([]);
    const [cSlotsLoading, setCSlotsLoading] = useState(false);
    const [cSlotsError, setCSlotsError] = useState(false);
    const [cSlot, setCSlot] = useState<Slot | null>(null);
    const [cNotes, setCNotes] = useState('');
    const [cContactSearch, setCContactSearch] = useState('');
    const [cContact, setCContact] = useState<{ id: string; name: string } | null>(null);
    const [cSubjectId, setCSubjectId] = useState('');
    const [creating, setCreating] = useState(false);

    // Keep the list bounded for large tenants, but wide enough that it no
    // longer hides day 15 onward. Creation/rescheduling accepts any future date.
    const { data: apptData, isLoading: loading, isFetching, isError, refetch } = useQuery({
        queryKey: ['appointments', tenantId],
        queryFn: async () => {
            if (!tenantId) return [];
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const horizon = new Date(today);
            horizon.setDate(horizon.getDate() + 180);
            // El endpoint filtra por startDate/endDate — 'start'/'end' se ignoraban
            // en silencio y la lista venía SIN filtrar (toda la historia del tenant).
            // Hora-pared local SIN zona (mismo contrato que toIsoAt): toISOString()
            // mandaba medianoche Bogotá como 05:00Z y el cast naive excluía las
            // citas de 00:00-05:00 de hoy en todo huso negativo.
            const params = `startDate=${localDate(today)}T00:00:00&endDate=${localDate(horizon)}T23:59:59`;
            const res: any = await api.getAppointments(tenantId, params);
            // Throw on failure so isError renders the error+retry state — returning []
            // here made a failed request indistinguishable from a clear calendar.
            if (!res?.success) throw new Error(res?.error || 'load_failed');
            const data = Array.isArray(res.data) ? res.data : res.data?.appointments || [];
            return data
                .filter((a: Appt) => { const s = start(a); return s && s >= today && !isTerminal(a); })
                .sort((a: Appt, b: Appt) => (start(a)!.getTime()) - (start(b)!.getTime())) as Appt[];
        },
        staleTime: 5 * 60 * 1000,
        enabled: !!tenantId,
        throwOnError: false,
    });

    // Filter again at render time as a cache-safety boundary: Fast Refresh or
    // persisted React Query data may have been produced by an older queryFn.
    const items: Appt[] = (apptData || []).filter((appointment: Appt) => !isTerminal(appointment));
    const refreshing = isFetching && !loading;

    const appointmentContactsQuery = useQuery<any[]>({
        queryKey: ['appointment-contacts', tenantId],
        queryFn: async () => {
            if (!tenantId) return [];
            const contacts = await collectApiPages<any>(
                (limit, offset) => api.getOrderContacts(tenantId, { limit, offset }),
            );
            return contacts.filter((contact: any) => validTenantContactId(contact?.id));
        },
        enabled: !!tenantId && createOpen,
        staleTime: 2 * 60 * 1000,
        throwOnError: false,
    });
    const appointmentContacts = appointmentContactsQuery.data || [];
    const cContactResults = useMemo(() => {
        const query = cContactSearch.trim().toLocaleLowerCase(LOCALE_TAG[locale]);
        return appointmentContacts.filter((contact: any) => {
            if (!query) return true;
            return [contact.name, contact.phone, contact.email]
                .filter(Boolean)
                .some((value) => String(value).toLocaleLowerCase(LOCALE_TAG[locale]).includes(query));
        }).slice(0, 20);
    }, [appointmentContacts, cContactSearch, locale]);

    useEffect(() => {
        let active = true;
        setServices([]);
        setCServiceId('');
        setServicesError(false);
        setServicesLoading(false);
        if (!tenantId) return () => { active = false; };

        setServicesLoading(true);
        api.getBookableServices(tenantId).then((response: any) => {
            if (!active) return;
            if (!response?.success || !Array.isArray(response.data)) {
                throw new Error(response?.error || 'services_failed');
            }
            setServices(response.data);
            setCServiceId(response.data[0]?.id || '');
        }).catch(() => {
            if (!active) return;
            setServices([]);
            setServicesError(true);
        }).finally(() => { if (active) setServicesLoading(false); });

        return () => { active = false; };
    }, [tenantId, servicesRetryKey]);

    useEffect(() => {
        let active = true;
        setSubjectOptions([]);
        setCSubjectId('');
        if (!tenantId || !subjectKind) return () => { active = false; };

        setSubjectsLoading(true);
        const request = subjectKind === 'listing'
            ? api.getRealEstateListings(tenantId)
            : collectApiPages<any>((limit, offset) => subjectKind === 'pet'
                ? api.getPets(tenantId, { limit, offset })
                : api.getVehicles(tenantId, { status: 'available', limit, offset }))
                .then((items) => ({ success: true, data: { items } }));

        request.then((response: any) => {
            if (!active || !response?.success) return;
            const raw = response.data;
            const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
            const options = rows.map((row: any): SubjectOption | null => {
                if (!row?.id) return null;
                if (subjectKind === 'listing') {
                    return {
                        id: String(row.id),
                        name: String(row.name || row.address || row.id),
                        detail: [row.neighborhood, row.city].filter(Boolean).join(' · '),
                    };
                }
                if (subjectKind === 'pet') {
                    return {
                        id: String(row.id),
                        name: String(row.name || row.id),
                        detail: [row.species, row.contact_name || row.contactName].filter(Boolean).join(' · '),
                        contactId: row.contact_id || row.contactId || undefined,
                        contactName: row.contact_name || row.contactName || undefined,
                    };
                }
                if (subjectKind === 'vehicle') {
                    return {
                        id: String(row.id),
                        name: [row.make, row.model, row.year].filter(Boolean).join(' ') || String(row.id),
                        detail: [row.color, row.license_plate || row.licensePlate].filter(Boolean).join(' · '),
                    };
                }
                return null;
            }).filter((option: SubjectOption | null): option is SubjectOption => !!option);
            setSubjectOptions(options);
        }).catch(() => {
            // Optional context: appointment creation stays available if a
            // vertical catalog is unavailable or gated for this tenant.
        }).finally(() => { if (active) setSubjectsLoading(false); });

        return () => { active = false; };
    }, [tenantId, subjectKind]);

    const customerName = (appointment: Appt) => customer(appointment, t('citas.customer'));
    const serviceName = (appointment: Appt) => service(appointment, t('citas.service'));
    const subjectTypeLabel = (kind: SubjectKind) => {
        const key = SUBJECT_LABEL_KEY[kind];
        const translated = t(key);
        return translated === key ? t('citas.service') : translated;
    };
    const linkedSubject = (appointment: Appt): { kind: SubjectKind; id: string; name: string } | null => {
        const metadata = appointment.metadata || {};
        const candidates: Array<{ kind: SubjectKind; value: unknown }> = [
            { kind: 'listing', value: metadata.listingId || metadata.listing_id },
            { kind: 'pet', value: metadata.petId || metadata.pet_id },
            { kind: 'vehicle', value: metadata.vehicleId || metadata.vehicle_id },
        ];
        const linked = candidates.find((candidate) => typeof candidate.value === 'string' && candidate.value);
        if (!linked) return null;
        const id = String(linked.value);
        const option = subjectOptions.find((candidate) => candidate.id === id);
        return { kind: linked.kind, id, name: option?.name || `#${id.slice(0, 8)}` };
    };
    const selectableSubjectOptions = useMemo(
        () => subjectKind === 'pet' && cContact?.id
            ? subjectOptions.filter((option) => !option.contactId || option.contactId === cContact.id)
            : subjectOptions,
        [subjectKind, subjectOptions, cContact?.id],
    );

    const confirm = async (a: Appt) => {
        if (!tenantId || isTerminal(a) || normalizedStatus(a) === 'confirmed') return;
        setBusy(a.id);
        try {
            const r: any = await api.updateAppointment(tenantId, a.id, { status: 'confirmed' });
            if (!r?.success) throw new Error('fail');
            toast.success(t('citas.confirmed'));
            setSelected((current) => current?.id === a.id ? { ...current, status: 'confirmed' } : current);
            await refetch();
        }
        catch { toast.error(t('citas.confirmError')); }
        finally { setBusy(''); }
    };
    const cancel = (a: Appt) => {
        if (isTerminal(a)) return;
        Alert.alert(t('citas.cancelTitle'), t('citas.cancelConfirm', { name: customerName(a) }), [
            { text: t('citas.no'), style: 'cancel' },
            { text: t('citas.yesCancel'), style: 'destructive', onPress: async () => {
                if (!tenantId) return;
                setBusy(a.id);
                try {
                    const r: any = await api.cancelAppointment(tenantId, a.id, t('citas.cancelReason'));
                    if (!r?.success) throw new Error('fail');
                    toast.success(t('citas.cancelled')); setSelected(null); await refetch();
                }
                catch { toast.error(t('citas.cancelError')); }
                finally { setBusy(''); }
            } },
        ]);
    };

    // Resolve the appointment's service id (needed for slot lookup).
    const serviceIdFor = (a: Appt): string | null => {
        if (a.service_id || a.serviceId) return a.service_id || a.serviceId!;
        const name = serviceName(a).toLowerCase();
        const match = services.find((s) => String(s.name || '').toLowerCase() === name);
        return match?.id || null;
    };

    const openDetail = (a: Appt) => {
        haptic.tap();
        setSelected(a);
        setRDate('');
        setRDateInput('');
        setSlots([]);
        setSlotsError(false);
    };

    const pickDate = async (dateStr: string) => {
        if (!tenantId || !selected || isTerminal(selected)) return;
        if (!isValidFutureDate(dateStr)) { toast.error(t('citas.invalidDate')); return; }
        const sid = serviceIdFor(selected);
        setRDate(dateStr); setRDateInput(dateStr); setSlots([]); setSlotsError(false);
        if (!sid) { toast.error(t('citas.serviceUnknown')); return; }
        setSlotsLoading(true);
        try {
            const r: any = await api.getBookableSlots(tenantId, dateStr, sid);
            setSlots(slotsFromResponse(r));
        } catch { setSlots([]); setSlotsError(true); }
        finally { setSlotsLoading(false); }
    };

    const chooseSlot = async (slot: Slot) => {
        if (!tenantId || !selected || !rDate || isTerminal(selected)) return;
        const startAt = toIsoAt(rDate, slot.time);
        const endAt = toIsoAt(rDate, slot.endTime || slot.time);
        setRescheduling(true);
        try {
            // El slot elegido puede pertenecer a la agenda de OTRO agente: sin
            // reasignar, el asignado original quedaba doble-reservado.
            const r: any = await api.updateAppointment(tenantId, selected.id, {
                startAt, endAt,
                ...(slot.agentId ? { assignedTo: slot.agentId } : {}),
            });
            if (!r?.success) throw new Error('fail');
            toast.success(t('citas.rescheduled'));
            setSelected(null);
            await refetch();
        } catch { toast.error(t('citas.rescheduleError')); }
        finally { setRescheduling(false); }
    };

    const openCreate = () => {
        haptic.tap();
        setCServiceId(services[0]?.id || ''); setCDate(''); setCDateInput(''); setCSlots([]); setCSlot(null); setCSlotsError(false);
        setCNotes(''); setCContactSearch(''); setCContact(null);
        setCSubjectId('');
        setCreateOpen(true);
    };
    const cPickDate = async (dateStr: string) => {
        if (!tenantId || !cServiceId) return;
        if (!isValidFutureDate(dateStr)) { toast.error(t('citas.invalidDate')); return; }
        setCDate(dateStr); setCDateInput(dateStr); setCSlots([]); setCSlot(null); setCSlotsError(false);
        setCSlotsLoading(true);
        try {
            const r: any = await api.getBookableSlots(tenantId, dateStr, cServiceId);
            setCSlots(slotsFromResponse(r));
        } catch { setCSlots([]); setCSlotsError(true); }
        finally { setCSlotsLoading(false); }
    };
    const createAppt = async () => {
        if (!tenantId || !cServiceId || !cDate || !cSlot) return;
        const contactId = validTenantContactId(cContact?.id);
        if (!contactId) { toast.error(t('citas.contactRequiredError')); return; }
        const svc = services.find((s) => s.id === cServiceId);
        const startAt = toIsoAt(cDate, cSlot.time);
        const endAt = toIsoAt(cDate, cSlot.endTime || cSlot.time);
        setCreating(true);
        try {
            const payload: Record<string, any> = { serviceName: svc?.name, serviceId: cServiceId, startAt, endAt };
            if (cSlot.agentId) payload.assignedTo = cSlot.agentId;
            payload.contactId = contactId;
            if (cNotes.trim()) payload.notes = cNotes.trim();
            if (subjectKind && cSubjectId) {
                payload.metadata = { [SUBJECT_META_KEY[subjectKind]]: cSubjectId };
            }
            const r: any = await api.createAppointment(tenantId, payload);
            if (!r?.success) throw new Error('fail');
            toast.success(t('citas.created'));
            setCreateOpen(false);
            await refetch();
        } catch { toast.error(t('citas.createError')); }
        finally { setCreating(false); }
    };

    if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></SafeAreaView>;

    // Solo pantalla completa de error si NO hay datos (ver PipelineScreen).
    if (isError && !apptData) return (
        <SafeAreaView style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={40} color={theme.textSecondary} />
            <Text style={[styles.empty, { marginTop: 10 }]}>{t('citas.loadError')}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
        </SafeAreaView>
    );

    const todayStr = new Date().toDateString();
    const selectedSubject = selected ? linkedSubject(selected) : null;
    const selectedManageable = !!selected && !isTerminal(selected);
    const selectedHasServiceId = !!(selected?.service_id || selected?.serviceId);

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>
            <Text style={styles.h1}>{verticalTitle}</Text>
            <FlatList
                data={items}
                keyExtractor={(a) => a.id}
                contentContainerStyle={{ paddingBottom: 24 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refetch()} tintColor={theme.accent} />}
                ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>{t('citas.empty')}</Text></View>}
                renderItem={({ item }) => {
                    const s = start(item);
                    const subject = linkedSubject(item);
                    const isToday = s && s.toDateString() === todayStr;
                    const time = s ? s.toLocaleTimeString(LOCALE_TAG[locale], { hour: '2-digit', minute: '2-digit' }) : '';
                    const day = s ? (isToday ? t('citas.today') : s.toLocaleDateString(LOCALE_TAG[locale], { weekday: 'short', day: 'numeric', month: 'short' })) : '';
                    const itemStatus = normalizedStatus(item);
                    const statusColor = STATUS_COLOR[itemStatus] || theme.textSecondary;
                    const manageable = !isTerminal(item);
                    return (
                        <PressableScale style={styles.card} onPress={() => openDetail(item)}
                            accessibilityRole="button" accessibilityLabel={`${serviceName(item)} · ${customerName(item)}`} accessibilityHint={t('citas.tapToManage')}>
                            <View style={styles.timeCol}>
                                <Text style={[styles.day, isToday && { color: theme.accent }]}>{day}</Text>
                                <Text style={styles.time}>{time}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.svc}>{serviceName(item)}</Text>
                                <Text style={styles.cust}>{customerName(item)}</Text>
                                {!!subject && (
                                    <View style={styles.subjectLine}>
                                        <Ionicons name={subject.kind === 'listing' ? 'home-outline' : subject.kind === 'pet' ? 'paw-outline' : 'car-outline'} size={12} color={theme.accent} />
                                        <Text style={styles.subjectText} numberOfLines={1}>{subjectTypeLabel(subject.kind)}: {subject.name}</Text>
                                    </View>
                                )}
                                <View style={styles.badgeRow}>
                                    <View style={[styles.badge, { backgroundColor: statusColor + '22' }]}>
                                        <Text style={[styles.badgeText, { color: statusColor }]}>{statusLabel(t, item.status)}</Text>
                                    </View>
                                </View>
                            </View>
                            {manageable && <View style={styles.apptActions}>
                                {itemStatus !== 'confirmed' && (
                                    <TouchableOpacity onPress={() => confirm(item)} disabled={busy === item.id}
                                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.apptBtn}
                                        accessibilityRole="button" accessibilityLabel={t('citas.confirmA11y', { name: customerName(item) })}>
                                        <Ionicons name="checkmark-circle-outline" size={26} color={theme.success} />
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity onPress={() => cancel(item)} disabled={busy === item.id}
                                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.apptBtn}
                                    accessibilityRole="button" accessibilityLabel={t('citas.cancelA11y', { name: customerName(item) })}>
                                    <Ionicons name="close-circle-outline" size={26} color={theme.danger} />
                                </TouchableOpacity>
                            </View>}
                        </PressableScale>
                    );
                }}
            />

            {/* Create-appointment FAB */}
            <TouchableOpacity style={[styles.fab, { bottom: 24 + insets.bottom }]} onPress={openCreate} accessibilityRole="button" accessibilityLabel={t('citas.new')}>
                <Ionicons name="add" size={28} color="#fff" />
            </TouchableOpacity>

            {/* Detail + reschedule sheet */}
            <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
                <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSelected(null)}>
                    <View style={styles.sheet} onStartShouldSetResponder={() => true}>
                        {selected && (
                            <ScrollView>
                                <Text style={styles.sheetTitle}>{serviceName(selected)}</Text>
                                <Row label={t('citas.field.customer')} value={customerName(selected)} />
                                <Row label={t('citas.field.when')} value={start(selected)?.toLocaleString(LOCALE_TAG[locale], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} />
                                <Row label={t('citas.field.status')} value={statusLabel(t, selected.status)} />
                                {!!selectedSubject && <Row label={subjectTypeLabel(selectedSubject.kind)} value={selectedSubject.name} />}
                                <Row label={t('citas.field.assigned')} value={selected.assigned_name || selected.assignedName} />
                                <Row label={t('citas.field.location')} value={selected.location} />
                                <Row label={t('citas.field.notes')} value={selected.notes} />

                                {selectedManageable && <>
                                    {/* Reschedule */}
                                    <Text style={styles.sectionLabel}>{t('citas.reschedule')}</Text>
                                    {!selectedHasServiceId && servicesLoading ? (
                                        <ActivityIndicator color={theme.accent} style={{ marginTop: 10 }} />
                                    ) : !selectedHasServiceId && servicesError ? (
                                        <InlineRetry onRetry={() => setServicesRetryKey((key) => key + 1)} t={t} />
                                    ) : !selectedHasServiceId && services.length === 0 ? (
                                        <Text style={[styles.empty, { marginTop: 8 }]}>{t('citas.noServices')}</Text>
                                    ) : <>
                                        <Text style={styles.hint}>{t('citas.pickDate')}</Text>
                                        <DateSelector
                                            value={rDateInput}
                                            selectedValue={rDate}
                                            onChange={(value) => {
                                                setRDateInput(value);
                                                if (value !== rDate) { setRDate(''); setSlots([]); setSlotsError(false); }
                                            }}
                                            onSelect={pickDate}
                                            t={t}
                                        />
                                    </>}

                                    {!!rDate && (
                                        <>
                                            <Text style={styles.hint}>{t('citas.pickSlot')}</Text>
                                            {slotsLoading ? (
                                                <ActivityIndicator color={theme.accent} style={{ marginTop: 10 }} />
                                            ) : slotsError ? (
                                                <InlineRetry onRetry={() => pickDate(rDate)} t={t} />
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
                                        {normalizedStatus(selected) !== 'confirmed' && (
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
                                </>}
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
                                {servicesLoading ? (
                                    <ActivityIndicator color={theme.accent} style={{ marginVertical: 8 }} />
                                ) : servicesError ? (
                                    <InlineRetry onRetry={() => setServicesRetryKey((key) => key + 1)} t={t} />
                                ) : services.length === 0 ? (
                                    <Text style={styles.empty}>{t('citas.noServices')}</Text>
                                ) : (
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                                        {services.map((s) => {
                                            const on = s.id === cServiceId;
                                            return (
                                                <TouchableOpacity key={s.id} onPress={() => { setCServiceId(s.id); setCDate(''); setCDateInput(''); setCSlots([]); setCSlot(null); setCSlotsError(false); }}
                                                    style={[styles.svcChip, on && { backgroundColor: (s.color || theme.accent) + '22', borderColor: s.color || theme.accent }]}>
                                                    <Text style={[styles.svcChipText, on && { color: theme.text }]}>{s.name}</Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </ScrollView>
                                )}

                                <Text style={styles.sectionLabel}>{t('citas.contactRequired')}</Text>
                                {cContact ? (
                                    <View style={styles.selectedContact}>
                                        <Text style={styles.selectedContactText}>{cContact.name}</Text>
                                        <TouchableOpacity onPress={() => { setCContact(null); setCContactSearch(''); }}><Ionicons name="close-circle" size={18} color={theme.textSecondary} /></TouchableOpacity>
                                    </View>
                                ) : (
                                    <>
                                        <TextInput style={styles.input} placeholder={t('citas.searchContact')} placeholderTextColor={theme.textSecondary} value={cContactSearch} onChangeText={setCContactSearch} />
                                        {appointmentContactsQuery.isLoading && <ActivityIndicator color={theme.accent} style={{ marginVertical: 8 }} />}
                                        {appointmentContactsQuery.isError && (
                                            <InlineRetry onRetry={() => appointmentContactsQuery.refetch()} t={t} messageKey="citas.contactsLoadError" />
                                        )}
                                        {!appointmentContactsQuery.isLoading && !appointmentContactsQuery.isError && appointmentContacts.length === 0 && (
                                            <Text style={[styles.empty, { marginTop: 8 }]}>{t('citas.noContacts')}</Text>
                                        )}
                                        {cContactResults.map((contact) => {
                                            const nm = contact.name || contact.phone || contact.email || t('citas.customer');
                                            return (
                                                <TouchableOpacity key={contact.id} style={styles.contactRow} onPress={() => {
                                                    setCContact({ id: contact.id, name: nm });
                                                    if (subjectKind === 'pet') setCSubjectId('');
                                                }}>
                                                    <Text style={styles.contactName}>{nm}</Text>
                                                    {!!contact.phone && <Text style={styles.contactSub}>{contact.phone}</Text>}
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </>
                                )}

                                {!!subjectKind && (subjectsLoading || selectableSubjectOptions.length > 0) && (
                                    <>
                                        <Text style={styles.sectionLabel}>{t('citas.subjectOptional')}</Text>
                                        {subjectsLoading ? (
                                            <ActivityIndicator color={theme.accent} style={{ marginVertical: 8 }} />
                                        ) : (
                                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                                                {selectableSubjectOptions.map((option) => {
                                                    const on = option.id === cSubjectId;
                                                    return (
                                                        <TouchableOpacity
                                                            key={option.id}
                                                            onPress={() => {
                                                                setCSubjectId(on ? '' : option.id);
                                                                if (!on && subjectKind === 'pet' && !cContact && option.contactId) {
                                                                    setCContact({
                                                                        id: option.contactId,
                                                                        name: option.contactName || t('citas.customer'),
                                                                    });
                                                                }
                                                            }}
                                                            style={[styles.subjectChip, on && styles.subjectChipSelected]}
                                                            accessibilityRole="button"
                                                            accessibilityState={{ selected: on }}
                                                        >
                                                            <Text style={[styles.subjectChipName, on && { color: theme.text }]} numberOfLines={1}>{option.name}</Text>
                                                            {!!option.detail && <Text style={styles.subjectChipDetail} numberOfLines={1}>{option.detail}</Text>}
                                                        </TouchableOpacity>
                                                    );
                                                })}
                                            </ScrollView>
                                        )}
                                    </>
                                )}

                                <Text style={styles.sectionLabel}>{t('citas.pickDate')}</Text>
                                <DateSelector
                                    value={cDateInput}
                                    selectedValue={cDate}
                                    onChange={(value) => {
                                        setCDateInput(value);
                                        if (value !== cDate) { setCDate(''); setCSlots([]); setCSlot(null); setCSlotsError(false); }
                                    }}
                                    onSelect={cPickDate}
                                    disabled={!cServiceId}
                                    t={t}
                                />

                                {!!cDate && (cSlotsLoading ? (
                                    <ActivityIndicator color={theme.accent} style={{ marginTop: 8 }} />
                                ) : cSlotsError ? (
                                    <InlineRetry onRetry={() => cPickDate(cDate)} t={t} />
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

                                <TouchableOpacity style={[styles.primaryBtn, (creating || !cSlot || !validTenantContactId(cContact?.id)) && { opacity: 0.5 }]} onPress={createAppt} disabled={creating || !cSlot || !validTenantContactId(cContact?.id)}>
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

function InlineRetry({ onRetry, t, messageKey = 'citas.slotsError' }: { onRetry: () => void; t: Translator; messageKey?: string }) {
    return (
        <View style={{ alignItems: 'flex-start', marginTop: 8 }}>
            <Text style={styles.empty}>{t(messageKey)}</Text>
            <TouchableOpacity
                style={styles.retryBtn}
                onPress={onRetry}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
            >
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
        </View>
    );
}

function DateSelector({
    value,
    selectedValue,
    onChange,
    onSelect,
    disabled = false,
    t,
}: {
    value: string;
    selectedValue: string;
    onChange: (value: string) => void;
    onSelect: (value: string) => void;
    disabled?: boolean;
    t: Translator;
}) {
    const shortcuts = [
        { days: 0, label: t('citas.today') },
        { days: 1, label: '+1' },
        { days: 7, label: '+7' },
        { days: 30, label: '+30' },
    ];

    return (
        <View style={[styles.dateSelector, disabled && { opacity: 0.45 }]}>
            <View style={styles.dateInputRow}>
                <TextInput
                    style={[styles.input, styles.dateInput]}
                    value={value}
                    onChangeText={onChange}
                    onSubmitEditing={() => onSelect(value)}
                    editable={!disabled}
                    placeholder={t('stays.datePlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="numbers-and-punctuation"
                    autoCorrect={false}
                    autoCapitalize="none"
                    maxLength={10}
                    returnKeyType="done"
                    accessibilityLabel={t('citas.pickDate')}
                />
                <TouchableOpacity
                    style={styles.dateApplyButton}
                    onPress={() => onSelect(value)}
                    disabled={disabled}
                    accessibilityRole="button"
                    accessibilityLabel={t('citas.applyDate')}
                >
                    <Ionicons name="arrow-forward" size={18} color="#fff" />
                </TouchableOpacity>
            </View>
            <View style={styles.quickDateRow}>
                {shortcuts.map(({ days, label }) => {
                    const date = quickDate(days);
                    const on = selectedValue === date;
                    return (
                        <TouchableOpacity
                            key={days}
                            style={[styles.quickDateChip, on && styles.quickDateChipSelected]}
                            onPress={() => onSelect(date)}
                            disabled={disabled}
                            accessibilityRole="button"
                            accessibilityLabel={days === 0 ? t('citas.today') : t('citas.quickDateA11y', { days })}
                        >
                            <Text style={[styles.quickDateText, on && { color: '#fff' }]}>{label}</Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
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
    retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, backgroundColor: theme.accent, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
    retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    empty: { color: theme.textSecondary },
    h1: { color: theme.text, fontSize: 22, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 12 },
    card: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginVertical: 5, padding: 12, borderRadius: 12, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, gap: 12 },
    timeCol: { width: 64, alignItems: 'center' },
    day: { color: theme.textSecondary, fontSize: 12 },
    time: { color: theme.text, fontSize: 16, fontWeight: '700', marginTop: 2 },
    svc: { color: theme.text, fontSize: 15, fontWeight: '600' },
    cust: { color: theme.textSecondary, fontSize: 13, marginTop: 1 },
    subjectLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
    subjectText: { color: theme.accent, fontSize: 11, flexShrink: 1 },
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
    dateSelector: { marginTop: 8 },
    dateInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dateInput: { flex: 1 },
    dateApplyButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
    quickDateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    quickDateChip: { minWidth: 48, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg },
    quickDateChipSelected: { backgroundColor: theme.accent, borderColor: theme.accent },
    quickDateText: { color: theme.textSecondary, fontSize: 12, fontWeight: '700' },
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
    subjectChip: { width: 150, minHeight: 58, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg },
    subjectChipSelected: { borderColor: theme.accent, backgroundColor: theme.accent + '1a' },
    subjectChipName: { color: theme.textSecondary, fontSize: 13, fontWeight: '700' },
    subjectChipDetail: { color: theme.textSecondary, fontSize: 10, marginTop: 3 },
    contactRow: { paddingVertical: 10, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    contactName: { color: theme.text, fontSize: 14, fontWeight: '500' },
    contactSub: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
    primaryBtn: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
    primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
