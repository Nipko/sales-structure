import React, { useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    RefreshControl,
    SectionList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n';
import { useToast } from '../components/Toast';
import { haptic } from '../lib/haptics';
import {
    resolveVerticalWorkspace,
    type VerticalWorkspaceKind,
} from '../lib/verticalWorkspace';
import { theme } from '../theme';
import { AppointmentsScreen } from './AppointmentsScreen';
import { ReservationsScreen } from './ReservationsScreen';

interface OperationItem {
    id: string;
    icon: string;
    title: string;
    subtitle?: string;
    subtitleKey?: string;
    status?: string;
    when?: string;
    dateOnly?: boolean;
    meta?: string;
    metaKey?: string;
    metaParams?: Record<string, string | number>;
    amount?: string;
    source?: 'restaurant_order' | 'order';
    nextStatus?: string;
}

interface OperationSection {
    key: string;
    data: OperationItem[];
}

type Translator = (key: string, params?: Record<string, string | number>) => string;

const STATUS_COLORS: Record<string, string> = {
    active: theme.success,
    accepted: theme.success,
    approved: theme.success,
    attended: theme.success,
    completed: theme.success,
    confirmed: theme.success,
    delivered: theme.success,
    enrolled: theme.success,
    paid: theme.success,
    ready: theme.success,
    reserved: theme.success,
    scheduled: theme.accent,
    sent: theme.accent,
    dispatched: theme.accent,
    in_progress: theme.accent,
    preparing: theme.warning,
    processing: theme.warning,
    quoted: theme.warning,
    received: theme.warning,
    reviewing: theme.warning,
    submitted: theme.warning,
    pending: theme.warning,
    partial: theme.warning,
    draft: theme.textSecondary,
    open: theme.accent,
    full: theme.warning,
    cancelled: theme.danger,
    dropped: theme.danger,
    expired: theme.danger,
    no_show: theme.danger,
    rejected: theme.danger,
    refunded: theme.textSecondary,
    suspended: theme.warning,
};

const KNOWN_STATUSES = new Set(Object.keys(STATUS_COLORS));
const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

function localDate(value?: string, dateOnly = false): Date | null {
    if (!value) return null;
    const raw = String(value);
    if (dateOnly || (/^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10)) && raw.length <= 10)) {
        const parts = raw.slice(0, 10).split('-').map(Number);
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatWhen(value: string | undefined, locale: string, dateOnly = false): string {
    const date = localDate(value, dateOnly);
    if (!date) return '';
    const localeTag: Record<string, string> = {
        es: 'es-CO',
        en: 'en-US',
        pt: 'pt-BR',
        fr: 'fr-FR',
    };
    const hasTime = !dateOnly && !!value && value.length > 10;
    return date.toLocaleString(localeTag[locale] || 'es-CO', hasTime
        ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
        : { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatMoney(value: unknown, currency: unknown, locale: string): string {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount === 0) return '';
    try {
        return new Intl.NumberFormat(
            locale === 'pt' ? 'pt-BR' : locale === 'fr' ? 'fr-FR' : locale === 'en' ? 'en-US' : 'es-CO',
            { style: 'currency', currency: String(currency || 'COP'), maximumFractionDigits: 0 },
        ).format(amount);
    } catch {
        return String(amount) + ' ' + String(currency || '');
    }
}

function responseData(res: any): any {
    if (!res?.success) throw new Error(res?.error || 'load_failed');
    return res.data;
}

function list(value: any): any[] {
    return Array.isArray(value) ? value : [];
}

function activeStatus(value: unknown, terminal: string[]): boolean {
    return !terminal.includes(String(value || '').toLowerCase());
}

function appointmentItem(row: any): OperationItem {
    return {
        id: 'appointment:' + row.id,
        icon: 'calendar-outline',
        title: row.service_name || row.serviceName || row.title || '',
        subtitle: row.customer_name || row.contact_name || row.customerName || row.contactName || '',
        status: row.status || 'scheduled',
        when: row.start_at || row.startAt,
        meta: row.location || row.assigned_name || row.assignedName || '',
    };
}

function restaurantNext(status: unknown): string | undefined {
    const next: Record<string, string> = {
        received: 'preparing',
        preparing: 'ready',
        ready: 'delivered',
    };
    return next[String(status || '').toLowerCase()];
}

async function loadOperationSections(
    kind: VerticalWorkspaceKind,
    tenantId: string,
    subType: string | null | undefined,
    bookingEnabled: boolean | null | undefined,
    locale: string,
): Promise<OperationSection[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 60);

    if (kind === 'tours') {
        const rows = list(responseData(await api.getTourBookings(tenantId)));
        return [{
            key: 'ops.section.tourBookings',
            data: rows
                .filter((row) => activeStatus(row.status, ['cancelled', 'completed']) && (!localDate(row.departure_date, true) || localDate(row.departure_date, true)!.getTime() >= today.getTime()))
                .sort((a, b) => String(a.departure_date || '').localeCompare(String(b.departure_date || '')))
                .map((row) => ({
                    id: 'tour:' + row.id,
                    icon: 'map-outline',
                    title: row.package_name || '',
                    subtitle: row.guest_name || '',
                    status: row.status || 'reserved',
                    when: row.departure_date,
                    dateOnly: true,
                    metaKey: row.party_size ? 'ops.peopleCount' : undefined,
                    metaParams: row.party_size ? { count: row.party_size } : undefined,
                    amount: formatMoney(row.total_price, row.currency, locale),
                })),
        }];
    }

    if (kind === 'restaurant') {
        const wantsReservations = bookingEnabled !== false
            && (subType === 'casual_dining' || subType === 'cafeteria' || !subType);
        const appointmentParams = 'startDate=' + localDay(today) + 'T00:00:00&endDate=' + localDay(horizon) + 'T00:00:00';
        const [ordersRes, appointmentsRes]: [any, any] = await Promise.all([
            api.getRestaurantOrders(tenantId),
            wantsReservations ? api.getAppointments(tenantId, appointmentParams) : Promise.resolve({ success: true, data: [] }),
        ]);
        if (!ordersRes?.success && !appointmentsRes?.success) throw new Error(ordersRes?.error || appointmentsRes?.error || 'load_failed');
        const orders = ordersRes?.success ? list(ordersRes.data) : [];
        const appointmentsRaw = appointmentsRes?.success
            ? (Array.isArray(appointmentsRes.data) ? appointmentsRes.data : list(appointmentsRes.data?.appointments))
            : [];
        return [
            {
                key: 'ops.section.activeOrders',
                data: orders
                    .filter((row) => activeStatus(row.status, ['delivered', 'cancelled']))
                    .map((row) => ({
                        id: 'restaurant:' + row.id,
                        icon: 'restaurant-outline',
                        title: row.customer_name || '',
                        subtitleKey: row.order_type ? 'ops.orderType.' + row.order_type : undefined,
                        status: row.status || 'received',
                        when: row.estimated_delivery_at || row.created_at,
                        meta: row.delivery_address || '',
                        metaKey: row.table_number ? 'ops.tableNumber' : undefined,
                        metaParams: row.table_number ? { number: row.table_number } : undefined,
                        amount: formatMoney(row.total, row.currency, locale),
                        source: 'restaurant_order' as const,
                        nextStatus: restaurantNext(row.status),
                    })),
            },
            {
                key: 'ops.section.upcomingReservations',
                data: appointmentsRaw
                    .filter((row: any) => activeStatus(row.status, ['cancelled', 'completed', 'no_show']))
                    .map(appointmentItem),
            },
        ];
    }

    if (kind === 'orders') {
        const overview = responseData(await api.getOrdersOverview(tenantId)) || {};
        return [{
            key: 'ops.section.orders',
            data: list(overview.orders)
                .filter((row) => activeStatus(row.status, ['paid', 'cancelled']))
                .map((row) => ({
                    id: 'order:' + row.id,
                    icon: 'bag-handle-outline',
                    title: row.contactName || '',
                    subtitle: list(row.items).map((item: any) => item.productName).filter(Boolean).slice(0, 2).join(', '),
                    status: row.status || 'pending',
                    when: row.createdAt,
                    metaKey: list(row.items).length ? 'ops.itemsCount' : undefined,
                    metaParams: list(row.items).length ? { count: list(row.items).length } : undefined,
                    amount: formatMoney(row.totalAmount, row.currency, locale),
                    source: 'order' as const,
                    nextStatus: row.status === 'pending' ? 'confirmed' : undefined,
                })),
        }];
    }

    if (kind === 'classes') {
        const rows = list(responseData(await api.getFitnessClasses(
            tenantId,
            localDay(today) + 'T00:00:00',
            localDay(horizon) + 'T23:59:59',
        )));
        return [{
            key: 'ops.section.classes',
            data: rows.map((row) => ({
                id: 'class:' + row.id,
                icon: 'barbell-outline',
                title: row.name || '',
                subtitle: row.instructor_name || row.room || '',
                status: row.available_spots === 0 ? 'full' : 'scheduled',
                when: row.scheduled_at,
                metaKey: 'ops.spotsCount',
                metaParams: { available: row.available_spots ?? 0, capacity: row.max_capacity ?? 0 },
            })),
        }];
    }

    if (kind === 'education') {
        const [enrollmentsRes, cohortsRes] = await Promise.all([
            api.getEducationEnrollments(tenantId),
            api.getEducationCohorts(tenantId),
        ]);
        const enrollments = list(responseData(enrollmentsRes));
        const cohorts = list(responseData(cohortsRes));
        return [
            {
                key: 'ops.section.activeEnrollments',
                data: enrollments
                    .filter((row) => activeStatus(row.status, ['completed', 'dropped', 'refunded']))
                    .map((row) => ({
                        id: 'enrollment:' + row.id,
                        icon: 'person-add-outline',
                        title: row.student_name || '',
                        subtitle: row.course_name || row.cohort_code || '',
                        status: row.status || 'enrolled',
                        when: row.cohort_starts_at || row.enrolled_at,
                        dateOnly: !!row.cohort_starts_at,
                    })),
            },
            {
                key: 'ops.section.upcomingCohorts',
                data: cohorts
                    .filter((row) => activeStatus(row.status, ['cancelled', 'finished']) && (!localDate(row.starts_at, true) || localDate(row.starts_at, true)!.getTime() >= today.getTime()))
                    .sort((a, b) => String(a.starts_at || '').localeCompare(String(b.starts_at || '')))
                    .map((row) => ({
                        id: 'cohort:' + row.id,
                        icon: 'school-outline',
                        title: row.course_name || row.cohort_code || '',
                        subtitle: row.instructor_name || row.schedule || '',
                        status: row.status || 'open',
                        when: row.starts_at,
                        dateOnly: true,
                        metaKey: 'ops.spotsCount',
                        metaParams: { available: row.available_seats ?? 0, capacity: row.max_capacity ?? 0 },
                    })),
            },
        ];
    }

    if (kind === 'insurance') {
        const [quotesRes, policiesRes, claimsRes] = await Promise.all([
            api.getInsuranceQuotes(tenantId),
            api.getInsurancePolicies(tenantId),
            api.getInsuranceClaims(tenantId),
        ]);
        const quotes = list(responseData(quotesRes));
        const policies = list(responseData(policiesRes));
        const claims = list(responseData(claimsRes));
        return [
            {
                key: 'ops.section.openQuotes',
                data: quotes
                    .filter((row) => activeStatus(row.status, ['accepted', 'rejected', 'expired']))
                    .map((row) => ({
                        id: 'quote:' + row.id,
                        icon: 'document-text-outline',
                        title: row.applicant_name || row.plan_name || '',
                        subtitle: row.plan_name || row.insurance_type || '',
                        status: row.status || 'draft',
                        when: row.created_at,
                        amount: formatMoney(row.monthly_premium || row.annual_premium, row.currency, locale),
                    })),
            },
            {
                key: 'ops.section.openClaims',
                data: claims
                    .filter((row) => activeStatus(row.status, ['paid', 'rejected']))
                    .map((row) => ({
                        id: 'claim:' + row.id,
                        icon: 'warning-outline',
                        title: row.claim_number || '',
                        subtitle: row.incident_type || row.description || '',
                        status: row.status || 'submitted',
                        when: row.incident_at || row.created_at,
                        dateOnly: !!row.incident_at,
                        amount: formatMoney(row.claimed_amount, row.currency, locale),
                    })),
            },
            {
                key: 'ops.section.activePolicies',
                data: policies
                    .filter((row) => activeStatus(row.status, ['expired', 'cancelled']))
                    .map((row) => ({
                        id: 'policy:' + row.id,
                        icon: 'shield-checkmark-outline',
                        title: row.policyholder_name || row.policy_number || '',
                        subtitle: row.policy_number || '',
                        status: row.status || 'active',
                        when: row.next_payment_at || row.ends_at || row.starts_at,
                        dateOnly: true,
                        amount: formatMoney(row.monthly_premium, row.currency, locale),
                    })),
            },
        ];
    }

    if (kind === 'service_requests') {
        const rows = list(responseData(await api.getServiceRequests(tenantId)));
        return [{
            key: 'ops.section.serviceRequests',
            data: rows
                .filter((row) => activeStatus(row.status, ['completed', 'cancelled']))
                .map((row) => ({
                    id: 'request:' + row.id,
                    icon: row.urgency === 'emergencia' ? 'alert-circle-outline' : 'construct-outline',
                    title: row.service_type || '',
                    subtitle: row.customer_name || row.issue_description || '',
                    status: row.status || 'pending',
                    when: row.scheduled_at || row.preferred_date || row.created_at,
                    dateOnly: !row.scheduled_at && !!row.preferred_date,
                    meta: row.address || row.city || '',
                    metaKey: row.urgency ? 'ops.urgency.' + row.urgency : undefined,
                    amount: formatMoney(row.estimated_cost, row.currency, locale),
                })),
        }];
    }

    if (kind === 'photo_sessions') {
        const payload = responseData(await api.getPhotoSessions(tenantId)) || {};
        return [{
            key: 'ops.section.photoSessions',
            data: list(payload.sessions)
                .filter((row) => activeStatus(row.status, ['delivered', 'cancelled']))
                .map((row) => ({
                    id: 'photo:' + row.id,
                    icon: 'camera-outline',
                    title: row.client_name || row.contact_name || '',
                    subtitle: row.package_name || row.session_type || '',
                    status: row.status || 'scheduled',
                    when: row.scheduled_at || row.delivery_due_at,
                    dateOnly: !row.scheduled_at && !!row.delivery_due_at,
                    meta: row.location || '',
                    amount: formatMoney(row.price, row.currency, locale),
                })),
        }];
    }

    if (kind === 'test_drives') {
        const rows = list(responseData(await api.getTestDrives(tenantId)));
        return [{
            key: 'ops.section.testDrives',
            data: rows
                .filter((row) => activeStatus(row.status, ['completed', 'cancelled', 'no_show']) && (!localDate(row.scheduled_date, true) || localDate(row.scheduled_date, true)!.getTime() >= today.getTime()))
                .sort((a, b) => String(a.scheduled_date || '').localeCompare(String(b.scheduled_date || '')))
                .map((row) => ({
                    id: 'drive:' + row.id,
                    icon: 'car-sport-outline',
                    title: [row.make, row.model, row.year].filter(Boolean).join(' '),
                    subtitle: row.contact_name || '',
                    status: row.status || 'scheduled',
                    when: row.scheduled_date,
                    dateOnly: true,
                    meta: row.scheduled_time || row.contact_phone || '',
                })),
        }];
    }

    return [];
}

function translatedToken(t: Translator, value?: string): string {
    if (!value) return '';
    if (value.startsWith('ops.')) return t(value);
    return value;
}

function itemSubtitle(t: Translator, item: OperationItem): string {
    return item.subtitleKey ? t(item.subtitleKey) : translatedToken(t, item.subtitle);
}

function itemMeta(t: Translator, item: OperationItem): string {
    return [
        item.metaKey ? t(item.metaKey, item.metaParams) : '',
        translatedToken(t, item.meta),
    ].filter(Boolean).join(' · ');
}

function statusLabel(t: Translator, status?: string): string {
    const normalized = String(status || '').toLowerCase();
    return KNOWN_STATUSES.has(normalized) ? t('ops.status.' + normalized) : t('ops.status.unknown');
}

function actionLabel(t: Translator, status: string): string {
    return t('ops.advance.' + status);
}

function UnavailableWorkspace() {
    const { t } = useI18n();
    return (
        <SafeAreaView style={styles.center}>
            <Ionicons name="layers-outline" size={46} color={theme.textSecondary} />
            <Text style={styles.emptyTitle}>{t('ops.unavailableTitle')}</Text>
            <Text style={styles.emptyText}>{t('ops.unavailableBody')}</Text>
        </SafeAreaView>
    );
}

export function VerticalOperationsScreen({ kind }: { kind: VerticalWorkspaceKind }) {
    const { tenantId, verticalConfig } = useAuth();
    const { t, locale } = useI18n();
    const toast = useToast();
    const insets = useSafeAreaInsets();
    const [selected, setSelected] = useState<OperationItem | null>(null);
    const [busyId, setBusyId] = useState('');
    const [tableReservationsOpen, setTableReservationsOpen] = useState(false);

    const restaurantSubType = String(verticalConfig?.subType || '').trim().toLowerCase();
    const canManageTableReservations = kind === 'restaurant'
        && verticalConfig?.bookingEnabled !== false
        && (restaurantSubType === 'casual_dining' || restaurantSubType === 'cafeteria' || !restaurantSubType);

    const query = useQuery({
        queryKey: ['vertical-operations', tenantId, kind, verticalConfig?.subType, verticalConfig?.bookingEnabled, locale],
        queryFn: () => loadOperationSections(
            kind,
            tenantId!,
            verticalConfig?.subType,
            verticalConfig?.bookingEnabled,
            locale,
        ),
        enabled: !!tenantId && kind !== 'none',
        staleTime: 2 * 60 * 1000,
        throwOnError: false,
    });

    const sections = useMemo(
        () => (query.data || []).filter((section) => section.data.length > 0),
        [query.data],
    );

    const openTableReservations = () => {
        if (!canManageTableReservations) return;
        haptic.tap();
        setSelected(null);
        setTableReservationsOpen(true);
    };

    const closeTableReservations = () => {
        setTableReservationsOpen(false);
        void query.refetch();
    };

    const advance = async (item: OperationItem) => {
        if (!tenantId || !item.nextStatus || !item.source || busyId) return;
        setBusyId(item.id);
        try {
            const res: any = item.source === 'restaurant_order'
                ? await api.updateRestaurantOrderStatus(tenantId, item.id.replace('restaurant:', ''), item.nextStatus)
                : await api.updateOrderStatus(tenantId, item.id.replace('order:', ''), item.nextStatus);
            if (!res?.success) throw new Error(res?.error || 'update_failed');
            haptic.success();
            toast.success(t('ops.updated'));
            await query.refetch();
        } catch {
            toast.error(t('ops.updateError'));
        } finally {
            setBusyId('');
        }
    };

    if (kind === 'none') return <UnavailableWorkspace />;
    if (query.isLoading) return <SafeAreaView style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></SafeAreaView>;
    if (query.isError && !query.data) {
        return (
            <SafeAreaView style={styles.center}>
                <Ionicons name="cloud-offline-outline" size={42} color={theme.textSecondary} />
                <Text style={styles.emptyTitle}>{t('ops.loadError')}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={() => query.refetch()} accessibilityRole="button">
                    <Ionicons name="refresh" size={17} color="#fff" />
                    <Text style={styles.retryText}>{t('common.retry')}</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.root} edges={['top']}>
            <Text style={styles.h1}>{t(resolveVerticalWorkspace(verticalConfig || {}).labelKey)}</Text>
            <SectionList
                sections={sections}
                keyExtractor={(item) => item.id}
                contentContainerStyle={[styles.content, sections.length === 0 && styles.emptyContent]}
                refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={() => query.refetch()} tintColor={theme.accent} />}
                ListHeaderComponent={canManageTableReservations ? (
                    <TouchableOpacity
                        style={styles.tableReservationsEntry}
                        activeOpacity={0.78}
                        onPress={openTableReservations}
                        accessibilityRole="button"
                        accessibilityLabel={t('ops.section.upcomingReservations')}
                        accessibilityHint={t('citas.tapToManage')}
                    >
                        <View style={styles.tableReservationsIcon}>
                            <Ionicons name="calendar-outline" size={21} color={theme.accent} />
                        </View>
                        <View style={styles.tableReservationsCopy}>
                            <Text style={styles.tableReservationsTitle}>{t('ops.section.upcomingReservations')}</Text>
                            <Text style={styles.tableReservationsHint}>{t('citas.tapToManage')}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={theme.accent} />
                    </TouchableOpacity>
                ) : null}
                ListEmptyComponent={(
                    <View style={styles.emptyBlock}>
                        <Ionicons name="checkmark-circle-outline" size={42} color={theme.textSecondary} />
                        <Text style={styles.emptyTitle}>{t('ops.emptyTitle')}</Text>
                        <Text style={styles.emptyText}>{t('ops.emptyBody')}</Text>
                    </View>
                )}
                renderSectionHeader={({ section }) => (
                    <Text style={styles.sectionTitle}>{t(section.key)}</Text>
                )}
                renderItem={({ item }) => {
                    const color = STATUS_COLORS[String(item.status || '').toLowerCase()] || theme.textSecondary;
                    return (
                        <TouchableOpacity
                            style={styles.card}
                            activeOpacity={0.78}
                            onPress={() => {
                                if (canManageTableReservations && item.id.startsWith('appointment:')) {
                                    openTableReservations();
                                    return;
                                }
                                haptic.tap();
                                setSelected(item);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={[item.title, statusLabel(t, item.status)].filter(Boolean).join(', ')}
                        >
                            <View style={[styles.iconCircle, { backgroundColor: color + '1c' }]}>
                                <Ionicons name={item.icon as any} size={21} color={color} />
                            </View>
                            <View style={styles.cardBody}>
                                <Text style={styles.cardTitle} numberOfLines={1}>{item.title || t('ops.untitled')}</Text>
                                {!!(item.subtitle || item.subtitleKey) && <Text style={styles.cardSubtitle} numberOfLines={2}>{itemSubtitle(t, item)}</Text>}
                                <View style={styles.metaRow}>
                                    {!!item.status && (
                                        <View style={[styles.badge, { backgroundColor: color + '1c' }]}>
                                            <Text style={[styles.badgeText, { color }]}>{statusLabel(t, item.status)}</Text>
                                        </View>
                                    )}
                                    {!!item.when && <Text style={styles.metaText}>{formatWhen(item.when, locale, item.dateOnly)}</Text>}
                                    {!!(item.meta || item.metaKey) && <Text style={styles.metaText} numberOfLines={1}>{itemMeta(t, item)}</Text>}
                                </View>
                            </View>
                            <View style={styles.trailing}>
                                {!!item.amount && <Text style={styles.amount}>{item.amount}</Text>}
                                {!!item.nextStatus && (
                                    <TouchableOpacity
                                        style={styles.advanceButton}
                                        onPress={() => advance(item)}
                                        disabled={busyId === item.id}
                                        accessibilityRole="button"
                                        accessibilityLabel={actionLabel(t, item.nextStatus)}
                                    >
                                        {busyId === item.id
                                            ? <ActivityIndicator size="small" color="#fff" />
                                            : <Text style={styles.advanceText}>{actionLabel(t, item.nextStatus)}</Text>}
                                    </TouchableOpacity>
                                )}
                            </View>
                        </TouchableOpacity>
                    );
                }}
            />

            <Modal visible={!!selected} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setSelected(null)}>
                <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSelected(null)}>
                    <View style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]} onStartShouldSetResponder={() => true}>
                        <View style={styles.sheetHandle} />
                        <Text style={styles.sheetTitle}>{selected?.title || t('ops.untitled')}</Text>
                        {!!(selected?.subtitle || selected?.subtitleKey) && <Text style={styles.sheetSubtitle}>{itemSubtitle(t, selected)}</Text>}
                        {!!selected?.status && (
                            <View style={styles.detailRow}>
                                <Text style={styles.detailLabel}>{t('ops.detail.status')}</Text>
                                <Text style={styles.detailValue}>{statusLabel(t, selected.status)}</Text>
                            </View>
                        )}
                        {!!selected?.when && (
                            <View style={styles.detailRow}>
                                <Text style={styles.detailLabel}>{t('ops.detail.when')}</Text>
                                <Text style={styles.detailValue}>{formatWhen(selected.when, locale, selected.dateOnly)}</Text>
                            </View>
                        )}
                        {!!(selected?.meta || selected?.metaKey) && (
                            <View style={styles.detailRow}>
                                <Text style={styles.detailLabel}>{t('ops.detail.info')}</Text>
                                <Text style={styles.detailValue}>{itemMeta(t, selected)}</Text>
                            </View>
                        )}
                        {!!selected?.amount && (
                            <View style={styles.detailRow}>
                                <Text style={styles.detailLabel}>{t('ops.detail.amount')}</Text>
                                <Text style={styles.detailValue}>{selected.amount}</Text>
                            </View>
                        )}
                        <TouchableOpacity style={styles.closeButton} onPress={() => setSelected(null)} accessibilityRole="button">
                            <Text style={styles.closeText}>{t('common.close')}</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>

            <Modal
                visible={canManageTableReservations && tableReservationsOpen}
                animationType="slide"
                presentationStyle="fullScreen"
                statusBarTranslucent
                onRequestClose={closeTableReservations}
            >
                <View style={styles.tableReservationsModal} accessibilityViewIsModal>
                    {canManageTableReservations && tableReservationsOpen && <AppointmentsScreen />}
                    <TouchableOpacity
                        style={[styles.tableReservationsClose, { top: insets.top + 8 }]}
                        onPress={closeTableReservations}
                        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.close')}
                    >
                        <Ionicons name="close" size={24} color={theme.text} />
                    </TouchableOpacity>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

export function OperationsScreen() {
    const { verticalConfig } = useAuth();
    const workspace = resolveVerticalWorkspace(verticalConfig || {});

    if (workspace.kind === 'appointments') return <AppointmentsScreen />;
    if (workspace.kind === 'stays') return <ReservationsScreen />;
    return <VerticalOperationsScreen kind={workspace.kind} />;
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, backgroundColor: theme.bg },
    content: { paddingBottom: 32 },
    emptyContent: { flexGrow: 1 },
    h1: { color: theme.text, fontSize: 24, fontWeight: '700', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
    tableReservationsEntry: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 58, marginHorizontal: 12, marginTop: 4, marginBottom: 8, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 13, backgroundColor: theme.accent + '12', borderColor: theme.accent + '55', borderWidth: 1 },
    tableReservationsIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent + '20' },
    tableReservationsCopy: { flex: 1, minWidth: 0 },
    tableReservationsTitle: { color: theme.text, fontSize: 14, lineHeight: 18, fontWeight: '700' },
    tableReservationsHint: { color: theme.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 2 },
    sectionTitle: { color: theme.textSecondary, backgroundColor: theme.bg, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 7 },
    card: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, marginHorizontal: 12, marginBottom: 8, borderRadius: 13, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1 },
    iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    cardBody: { flex: 1, minWidth: 0 },
    cardTitle: { color: theme.text, fontSize: 15, fontWeight: '700' },
    cardSubtitle: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
    metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginTop: 7 },
    badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
    badgeText: { fontSize: 10, fontWeight: '700' },
    metaText: { color: theme.textSecondary, fontSize: 10, flexShrink: 1 },
    trailing: { alignItems: 'flex-end', gap: 8, maxWidth: 105 },
    amount: { color: theme.text, fontSize: 12, fontWeight: '700' },
    advanceButton: { minHeight: 32, justifyContent: 'center', backgroundColor: theme.accent, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9 },
    advanceText: { color: '#fff', fontSize: 10, fontWeight: '700', textAlign: 'center' },
    emptyBlock: { flex: 1, minHeight: 360, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34 },
    emptyTitle: { color: theme.text, fontSize: 17, fontWeight: '700', textAlign: 'center', marginTop: 12 },
    emptyText: { color: theme.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 6 },
    retryButton: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16, backgroundColor: theme.accent, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
    retryText: { color: '#fff', fontWeight: '700' },
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.52)' },
    sheet: { backgroundColor: theme.bgCard, paddingHorizontal: 18, paddingTop: 10, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
    sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 16 },
    sheetTitle: { color: theme.text, fontSize: 19, fontWeight: '700' },
    sheetSubtitle: { color: theme.textSecondary, fontSize: 13, marginTop: 4, marginBottom: 12 },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, borderTopWidth: 1, borderTopColor: theme.border, paddingVertical: 12 },
    detailLabel: { color: theme.textSecondary, fontSize: 12, fontWeight: '600' },
    detailValue: { color: theme.text, fontSize: 13, flex: 1, textAlign: 'right' },
    closeButton: { backgroundColor: theme.accent, alignItems: 'center', borderRadius: 11, paddingVertical: 12, marginTop: 10 },
    closeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    tableReservationsModal: { flex: 1, backgroundColor: theme.bg },
    tableReservationsClose: { position: 'absolute', right: 12, zIndex: 30, elevation: 8, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
});
