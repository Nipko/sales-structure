import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import type { VerticalWorkspaceKind } from '../lib/verticalWorkspace';
import { useI18n } from '../i18n';
import { useToast } from '../components/Toast';
import { haptic } from '../lib/haptics';
import { theme } from '../theme';

type ComposerKind = Exclude<VerticalWorkspaceKind, 'appointments' | 'stays' | 'none'>;

interface Props {
    visible: boolean;
    kind: ComposerKind;
    tenantId: string;
    role?: string;
    initialMode?: string;
    initialPrimaryId?: string;
    initialSecondaryId?: string;
    initialQuoteId?: string;
    onClose: () => void;
    onCreated: () => void | Promise<void>;
}

interface ReferenceItem {
    id: string;
    title: string;
    subtitle?: string;
    raw: any;
}

type FormState = Record<string, string>;

const pad = (value: number) => String(value).padStart(2, '0');
const dayString = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function tomorrow(): string {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return dayString(date);
}

function validCalendarDay(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function validDay(value: string, allowToday = true): boolean {
    if (!validCalendarDay(value)) return false;
    return allowToday ? value >= dayString(new Date()) : value > dayString(new Date());
}

function validIncidentDay(value: string): boolean {
    return validCalendarDay(value) && value <= dayString(new Date());
}

function validTime(value: string): boolean {
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function rows(response: any): any[] {
    if (!response?.success) throw new Error(response?.error || 'load_failed');
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.data?.items)) return response.data.items;
    return [];
}

function initialForm(): FormState {
    return {
        date: tomorrow(),
        endDate: '',
        time: '10:00',
        quantity: '1',
        partySize: '2',
        capacity: '12',
        duration: '60',
        orderType: 'pickup',
        urgency: 'normal',
        currency: 'COP',
        startsAt: tomorrow(),
    };
}

function normalizeReferences(kind: ComposerKind, primary: any[], secondary: any[]): {
    primary: ReferenceItem[];
    secondary: ReferenceItem[];
} {
    const mappedPrimary = primary.map((item): ReferenceItem => {
        if (kind === 'tours') return { id: item.id, title: item.name || item.title || '', subtitle: item.destination || item.description, raw: item };
        if (kind === 'restaurant') return { id: item.id, title: item.name || '', subtitle: [item.category_name, Number(item.price || 0).toLocaleString()].filter(Boolean).join(' · '), raw: item };
        if (kind === 'orders') return { id: item.id, title: item.name || '', subtitle: [item.sku, `${item.stock ?? 0}`, Number(item.price || 0).toLocaleString()].filter(Boolean).join(' · '), raw: item };
        if (kind === 'classes') return { id: item.id, title: item.name || '', subtitle: [item.scheduled_at, item.instructor_name].filter(Boolean).join(' · '), raw: item };
        if (kind === 'education') return { id: item.id, title: item.course_name || item.cohort_code || '', subtitle: [item.cohort_code, item.starts_at].filter(Boolean).join(' · '), raw: item };
        if (kind === 'insurance') return { id: item.id, title: item.name || item.policyholder_name || item.policy_number || '', subtitle: item.insurance_type || item.policy_number, raw: item };
        if (kind === 'test_drives' || kind === 'vehicle_rentals') return { id: item.id, title: [item.make, item.model, item.year].filter(Boolean).join(' '), subtitle: item.color || item.license_plate || item.status, raw: item };
        if (kind === 'pet_boarding') return { id: item.id, title: item.name || item.pet_name || '', subtitle: [item.species, item.breed, item.owner_name || item.contact_name].filter(Boolean).join(' · '), raw: item };
        return { id: item.id, title: item.name || item.title || '', raw: item };
    });

    const mappedSecondary = secondary.map((item): ReferenceItem => {
        if (kind === 'classes') return { id: item.id, title: item.contact_name || item.member_number || '', subtitle: [item.member_number, item.plan_name].filter(Boolean).join(' · '), raw: item };
        if (kind === 'orders') return { id: item.id, title: item.name || item.contactName || '', subtitle: item.phone || item.email, raw: item };
        if (kind === 'insurance') return { id: item.id, title: item.policyholder_name || item.policy_number || '', subtitle: item.policy_number, raw: item };
        if (kind === 'pet_boarding') return { id: item.id, title: item.name || '', subtitle: [item.category, item.maxConcurrent ?? item.max_concurrent].filter(Boolean).join(' · '), raw: item };
        return { id: item.id, title: item.name || item.title || '', raw: item };
    });
    return { primary: mappedPrimary, secondary: mappedSecondary };
}

function Field({
    label,
    value,
    onChange,
    placeholder,
    keyboardType,
    multiline,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric' | 'numbers-and-punctuation';
    multiline?: boolean;
}) {
    return (
        <View style={styles.fieldWrap}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
                style={[styles.input, multiline && styles.multiline]}
                value={value}
                onChangeText={onChange}
                placeholder={placeholder}
                placeholderTextColor={theme.textSecondary}
                keyboardType={keyboardType}
                multiline={multiline}
                textAlignVertical={multiline ? 'top' : 'center'}
                autoCorrect={false}
            />
        </View>
    );
}

function Choices({
    label,
    value,
    choices,
    onChange,
}: {
    label?: string;
    value: string;
    choices: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
}) {
    return (
        <View style={styles.fieldWrap}>
            {!!label && <Text style={styles.label}>{label}</Text>}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {choices.map((choice) => {
                    const selected = choice.value === value;
                    return (
                        <TouchableOpacity
                            key={choice.value}
                            style={[styles.chip, selected && styles.chipSelected]}
                            onPress={() => { haptic.tap(); onChange(choice.value); }}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                        >
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{choice.label}</Text>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </View>
    );
}

function ReferencePicker({
    label,
    items,
    value,
    onChange,
    emptyLabel,
}: {
    label: string;
    items: ReferenceItem[];
    value: string;
    onChange: (value: string) => void;
    emptyLabel: string;
}) {
    return (
        <View style={styles.fieldWrap}>
            <Text style={styles.label}>{label}</Text>
            {!items.length ? <Text style={styles.hint}>{emptyLabel}</Text> : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.referenceRow}>
                    {items.map((item) => {
                        const selected = item.id === value;
                        return (
                            <TouchableOpacity
                                key={item.id}
                                style={[styles.referenceCard, selected && styles.referenceSelected]}
                                onPress={() => { haptic.tap(); onChange(item.id); }}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                            >
                                <Text style={[styles.referenceTitle, selected && styles.referenceTitleSelected]} numberOfLines={1}>{item.title}</Text>
                                {!!item.subtitle && <Text style={[styles.referenceSubtitle, selected && styles.referenceSubtitleSelected]} numberOfLines={2}>{item.subtitle}</Text>}
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            )}
        </View>
    );
}

export function OperationCreateModal({
    visible,
    kind,
    tenantId,
    role,
    initialMode,
    initialPrimaryId,
    initialSecondaryId,
    initialQuoteId,
    onClose,
    onCreated,
}: Props) {
    const { t } = useI18n();
    const toast = useToast();
    const insets = useSafeAreaInsets();
    const isManager = role === 'tenant_admin' || role === 'tenant_supervisor' || role === 'super_admin';
    const [form, setForm] = useState<FormState>(() => initialForm());
    const [mode, setMode] = useState('create');
    const [primary, setPrimary] = useState<ReferenceItem[]>([]);
    const [secondary, setSecondary] = useState<ReferenceItem[]>([]);
    const [selectedPrimary, setSelectedPrimary] = useState('');
    const [selectedSecondary, setSelectedSecondary] = useState('');
    const [cart, setCart] = useState<Record<string, number>>({});
    const [loadingReferences, setLoadingReferences] = useState(false);
    const [referenceError, setReferenceError] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

    const loadReferences = async () => {
        setLoadingReferences(true);
        setReferenceError(false);
        try {
            let primaryRows: any[] = [];
            let secondaryRows: any[] = [];
            if (kind === 'tours') primaryRows = rows(await api.getTourPackages(tenantId));
            if (kind === 'restaurant') primaryRows = rows(await api.getRestaurantItems(tenantId));
            if (kind === 'orders') {
                const [products, contacts] = await Promise.all([api.getInventoryProducts(tenantId), api.getOrderContacts(tenantId)]);
                primaryRows = rows(products);
                secondaryRows = rows(contacts);
            }
            if (kind === 'classes') {
                const from = dayString(new Date()) + 'T00:00:00';
                const until = new Date(); until.setDate(until.getDate() + 60);
                const [classes, members] = await Promise.all([
                    api.getFitnessClasses(tenantId, from, dayString(until) + 'T23:59:59'),
                    api.getGymMembers(tenantId),
                ]);
                primaryRows = rows(classes);
                secondaryRows = rows(members);
            }
            if (kind === 'education') primaryRows = rows(await api.getEducationCohorts(tenantId));
            if (kind === 'insurance') {
                const [plans, policies] = await Promise.all([api.getInsurancePlans(tenantId), api.getInsurancePolicies(tenantId)]);
                primaryRows = rows(plans);
                secondaryRows = rows(policies);
            }
            if (kind === 'test_drives' || kind === 'vehicle_rentals') primaryRows = rows(await api.getVehicles(tenantId, 'status=available&limit=200'));
            if (kind === 'pet_boarding') {
                const [pets, services] = await Promise.all([
                    api.getPets(tenantId, 'limit=200'),
                    api.getBookableServices(tenantId),
                ]);
                primaryRows = rows(pets);
                secondaryRows = rows(services).filter((service) => ['hotel', 'guarderia'].includes(String(service.category || '').toLowerCase()));
            }
            const normalized = normalizeReferences(kind, primaryRows, secondaryRows);
            setPrimary(normalized.primary);
            setSecondary(normalized.secondary);
            if (initialPrimaryId && normalized.primary.some((item) => item.id === initialPrimaryId)) {
                setSelectedPrimary(initialPrimaryId);
            } else if (normalized.primary.length === 1) setSelectedPrimary(normalized.primary[0].id);
            if (initialSecondaryId && normalized.secondary.some((item) => item.id === initialSecondaryId)) {
                setSelectedSecondary(initialSecondaryId);
            } else if (normalized.secondary.length === 1) setSelectedSecondary(normalized.secondary[0].id);
        } catch {
            setReferenceError(true);
        } finally {
            setLoadingReferences(false);
        }
    };

    useEffect(() => {
        if (!visible) return;
        const nextMode = initialMode || (kind === 'insurance' ? 'quote' : kind === 'classes' ? 'book' : 'create');
        const nextForm = initialForm();
        if (kind === 'insurance' && nextMode === 'claim') nextForm.date = dayString(new Date());
        setForm(nextForm);
        setSelectedPrimary('');
        setSelectedSecondary('');
        setCart({});
        setMode(nextMode);
        void loadReferences();
        // References are intentionally reloaded each time: stock, capacity and
        // active policies are operational data, not a static configuration.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, kind, tenantId, initialMode, initialPrimaryId, initialSecondaryId, initialQuoteId]);

    const selectedPrimaryRow = primary.find((item) => item.id === selectedPrimary);
    const selectedSecondaryRow = secondary.find((item) => item.id === selectedSecondary);

    const cartItems = useMemo(
        () => primary.filter((item) => (cart[item.id] || 0) > 0),
        [cart, primary],
    );

    const changeCart = (id: string, delta: number) => {
        setCart((current) => {
            const next = Math.max(0, (current[id] || 0) + delta);
            return { ...current, [id]: next };
        });
    };

    const canSubmit = useMemo(() => {
        if (kind === 'tours') return !!selectedPrimary && validDay(form.date) && validTime(form.time) && Number(form.partySize) > 0;
        if (kind === 'restaurant' || kind === 'orders') return cartItems.length > 0 && (kind !== 'restaurant' || form.orderType !== 'delivery' || !!form.address?.trim());
        if (kind === 'classes' && mode === 'book') return !!selectedPrimary && !!selectedSecondary;
        if (kind === 'classes') return isManager && !!form.name?.trim() && validDay(form.date) && validTime(form.time) && Number(form.capacity) > 0;
        if (kind === 'education') return isManager && !!selectedPrimary && !!form.customerName?.trim();
        if (kind === 'insurance' && mode === 'quote') return !!selectedPrimary && !!form.customerName?.trim();
        if (kind === 'insurance' && mode === 'claim') return !!selectedSecondary
            && !!form.description?.trim() && validIncidentDay(form.date);
        if (kind === 'insurance' && mode === 'policy') return isManager && !!form.policyNumber?.trim() && !!form.customerName?.trim() && Number(form.amount) > 0 && validDay(form.startsAt);
        if (kind === 'service_requests') return !!form.serviceType?.trim() && !!form.customerName?.trim();
        if (kind === 'photo_sessions') return isManager && !!form.sessionType?.trim() && !!form.customerName?.trim() && validDay(form.date) && validTime(form.time);
        if (kind === 'test_drives') return !!selectedPrimary && !!form.customerName?.trim() && validDay(form.date) && validTime(form.time);
        if (kind === 'vehicle_rentals' || kind === 'pet_boarding') return !!selectedPrimary
            && (kind !== 'pet_boarding' || !!selectedSecondary)
            && !!form.customerName?.trim() && validDay(form.date) && validDay(form.endDate) && form.endDate > form.date;
        return false;
    }, [cartItems.length, form, isManager, kind, mode, selectedPrimary, selectedSecondary]);

    const submit = async () => {
        if (!canSubmit || submitting) return;
        setSubmitting(true);
        try {
            let response: any;
            if (kind === 'tours') {
                const availability: any = await api.getTourAvailability(tenantId, selectedPrimary, form.date, Number(form.partySize));
                if (!availability?.success || availability.data?.available === false) throw new Error('unavailable');
                response = await api.createTourBooking(tenantId, {
                    packageId: selectedPrimary,
                    departureDate: form.date,
                    departureTime: form.time,
                    partySize: Number(form.partySize),
                    guestName: form.customerName?.trim() || undefined,
                    guestPhone: form.phone?.trim() || undefined,
                    specialRequests: form.notes?.trim() || undefined,
                });
            } else if (kind === 'restaurant') {
                response = await api.createRestaurantOrder(tenantId, {
                    orderType: form.orderType,
                    customerName: form.customerName?.trim() || undefined,
                    customerPhone: form.phone?.trim() || undefined,
                    deliveryAddress: form.orderType === 'delivery' ? form.address?.trim() : undefined,
                    tableNumber: form.orderType === 'dine_in' ? form.tableNumber?.trim() : undefined,
                    notes: form.notes?.trim() || undefined,
                    items: cartItems.map((item) => ({
                        menuItemId: item.id,
                        name: item.raw.name,
                        quantity: cart[item.id],
                        unitPrice: Number(item.raw.price || 0),
                        currency: item.raw.currency || 'COP',
                        prepTimeMinutes: item.raw.prep_time_minutes ?? null,
                    })),
                });
            } else if (kind === 'orders') {
                response = await api.createOrder(tenantId, {
                    contactId: selectedSecondary || undefined,
                    paymentMethod: form.paymentMethod?.trim() || undefined,
                    notes: form.notes?.trim() || undefined,
                    items: cartItems.map((item) => ({
                        productId: item.id,
                        productName: item.raw.name,
                        quantity: cart[item.id],
                        unitPrice: Number(item.raw.price || 0),
                    })),
                });
            } else if (kind === 'classes' && mode === 'book') {
                response = await api.bookFitnessClass(tenantId, selectedPrimary, selectedSecondary);
            } else if (kind === 'classes') {
                response = await api.createFitnessClass(tenantId, {
                    name: form.name.trim(),
                    scheduledAt: `${form.date}T${form.time}`,
                    maxCapacity: Number(form.capacity),
                    durationMinutes: Number(form.duration || 60),
                    instructorName: form.instructor?.trim() || undefined,
                    room: form.room?.trim() || undefined,
                });
            } else if (kind === 'education') {
                response = await api.createEducationEnrollment(tenantId, {
                    cohortId: selectedPrimary,
                    studentName: form.customerName.trim(),
                    studentEmail: form.email?.trim() || undefined,
                    studentPhone: form.phone?.trim() || undefined,
                });
            } else if (kind === 'insurance' && mode === 'quote') {
                response = await api.createInsuranceQuote(tenantId, {
                    planId: selectedPrimary,
                    applicantName: form.customerName.trim(),
                    applicantAge: form.age ? Number(form.age) : undefined,
                    applicantEmail: form.email?.trim() || undefined,
                    applicantPhone: form.phone?.trim() || undefined,
                });
            } else if (kind === 'insurance' && mode === 'claim') {
                response = await api.createInsuranceClaim(tenantId, {
                    policyId: selectedSecondary,
                    incidentType: form.incidentType?.trim() || undefined,
                    incidentAt: form.date,
                    description: form.description.trim(),
                    claimedAmount: form.amount ? Number(form.amount) : undefined,
                });
            } else if (kind === 'insurance') {
                response = await api.createInsurancePolicy(tenantId, {
                    policyNumber: form.policyNumber.trim(),
                    planId: selectedPrimary || initialPrimaryId || undefined,
                    quoteId: initialQuoteId || undefined,
                    policyholderName: form.customerName.trim(),
                    monthlyPremium: Number(form.amount),
                    currency: form.currency || 'COP',
                    startsAt: form.startsAt,
                    endsAt: validDay(form.endDate) ? form.endDate : undefined,
                });
            } else if (kind === 'service_requests') {
                response = await api.createServiceRequest(tenantId, {
                    serviceType: form.serviceType.trim(),
                    urgency: form.urgency,
                    customerName: form.customerName.trim(),
                    customerPhone: form.phone?.trim() || undefined,
                    address: form.address?.trim() || undefined,
                    city: form.city?.trim() || undefined,
                    issueDescription: form.description?.trim() || undefined,
                    preferredDate: validDay(form.date) ? form.date : undefined,
                    preferredTimeWindow: form.timeWindow?.trim() || undefined,
                });
            } else if (kind === 'photo_sessions') {
                response = await api.createPhotoSession(tenantId, {
                    sessionType: form.sessionType.trim(),
                    clientName: form.customerName.trim(),
                    clientPhone: form.phone?.trim() || undefined,
                    scheduledAt: `${form.date}T${form.time}:00`,
                    durationMinutes: Number(form.duration || 60),
                    location: form.address?.trim() || undefined,
                    packageName: form.packageName?.trim() || undefined,
                    price: form.amount ? Number(form.amount) : undefined,
                    currency: form.currency || 'COP',
                    notes: form.notes?.trim() || undefined,
                });
            } else if (kind === 'test_drives') {
                response = await api.createTestDrive(tenantId, {
                    vehicleId: selectedPrimary,
                    contactName: form.customerName.trim(),
                    contactPhone: form.phone?.trim() || undefined,
                    scheduledDate: form.date,
                    scheduledTime: form.time,
                    notes: form.notes?.trim() || undefined,
                });
            } else {
                response = await api.createResourceRental(tenantId, {
                    type: kind === 'vehicle_rentals' ? 'vehicle_rental' : 'pet_boarding',
                    resourceId: selectedPrimary,
                    serviceId: kind === 'pet_boarding' ? selectedSecondary : undefined,
                    customerName: form.customerName.trim(),
                    customerPhone: form.phone?.trim() || undefined,
                    startDate: form.date,
                    endDate: form.endDate,
                    notes: form.notes?.trim() || undefined,
                });
            }
            if (!response?.success) throw new Error(response?.error || 'create_failed');
            haptic.success();
            toast.success(t('ops.create.success'));
            await onCreated();
            onClose();
        } catch (error: any) {
            const unavailable = /unavailable|full|conflict|stock|capacity|ocupad|cupo/i.test(String(error?.message || error || ''));
            toast.error(t(unavailable ? 'ops.create.unavailable' : 'ops.create.error'));
        } finally {
            setSubmitting(false);
        }
    };

    const orderCatalog = kind === 'restaurant' || kind === 'orders';

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
            <SafeAreaView style={styles.root} edges={['top']}>
                <View style={styles.header}>
                    <View style={styles.headerText}>
                        <Text style={styles.title}>{t(`ops.create.title.${kind}`)}</Text>
                        <Text style={styles.subtitle}>{t(`ops.create.subtitle.${kind}`)}</Text>
                    </View>
                    <TouchableOpacity style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')}>
                        <Ionicons name="close" color={theme.text} size={24} />
                    </TouchableOpacity>
                </View>

                <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                    <ScrollView
                        style={styles.flex}
                        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}
                        keyboardShouldPersistTaps="handled"
                    >
                        {kind === 'insurance' && (
                            <Choices
                                value={mode}
                                onChange={(value) => {
                                    setMode(value);
                                    if (value === 'claim') set('date', dayString(new Date()));
                                }}
                                choices={[
                                    { value: 'quote', label: t('ops.create.mode.quote') },
                                    { value: 'claim', label: t('ops.create.mode.claim') },
                                    ...(isManager ? [{ value: 'policy', label: t('ops.create.mode.policy') }] : []),
                                ]}
                            />
                        )}
                        {kind === 'classes' && isManager && (
                            <Choices
                                value={mode}
                                onChange={setMode}
                                choices={[
                                    { value: 'book', label: t('ops.create.mode.book') },
                                    { value: 'create', label: t('ops.create.mode.class') },
                                ]}
                            />
                        )}

                        {loadingReferences && <ActivityIndicator color={theme.accent} style={styles.loader} />}
                        {referenceError && (
                            <View style={styles.errorBox}>
                                <Text style={styles.errorText}>{t('ops.create.referencesError')}</Text>
                                <TouchableOpacity onPress={() => void loadReferences()} accessibilityRole="button">
                                    <Text style={styles.retryText}>{t('common.retry')}</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {kind === 'tours' && <>
                            <ReferencePicker label={t('ops.field.package')} items={primary} value={selectedPrimary} onChange={setSelectedPrimary} emptyLabel={t('ops.create.configureCatalog')} />
                            <Field label={t('ops.field.departureDate')} value={form.date} onChange={(value) => set('date', value)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
                            <Field label={t('ops.field.departureTime')} value={form.time} onChange={(value) => set('time', value)} placeholder="HH:mm" keyboardType="numbers-and-punctuation" />
                            <Field label={t('ops.field.partySize')} value={form.partySize} onChange={(value) => set('partySize', value)} keyboardType="numeric" />
                            <Field label={t('ops.field.customerName')} value={form.customerName || ''} onChange={(value) => set('customerName', value)} />
                            <Field label={t('ops.field.phone')} value={form.phone || ''} onChange={(value) => set('phone', value)} keyboardType="phone-pad" />
                            <Field label={t('ops.field.notes')} value={form.notes || ''} onChange={(value) => set('notes', value)} multiline />
                        </>}

                        {orderCatalog && <>
                            <Text style={styles.label}>{t(kind === 'restaurant' ? 'ops.field.menuItems' : 'ops.field.products')}</Text>
                            {!primary.length && !loadingReferences && <Text style={styles.hint}>{t('ops.create.configureCatalog')}</Text>}
                            {primary.map((item) => {
                                const quantity = cart[item.id] || 0;
                                return (
                                    <View key={item.id} style={styles.cartRow}>
                                        <View style={styles.cartCopy}>
                                            <Text style={styles.cartTitle}>{item.title}</Text>
                                            {!!item.subtitle && <Text style={styles.cartSubtitle}>{item.subtitle}</Text>}
                                        </View>
                                        <TouchableOpacity style={styles.qtyButton} onPress={() => changeCart(item.id, -1)} disabled={!quantity} accessibilityRole="button"><Ionicons name="remove" size={18} color={quantity ? theme.text : theme.textSecondary} /></TouchableOpacity>
                                        <Text style={styles.quantity}>{quantity}</Text>
                                        <TouchableOpacity style={styles.qtyButton} onPress={() => changeCart(item.id, 1)} accessibilityRole="button"><Ionicons name="add" size={18} color={theme.text} /></TouchableOpacity>
                                    </View>
                                );
                            })}
                            {kind === 'restaurant' && <>
                                <Choices
                                    label={t('ops.field.orderType')}
                                    value={form.orderType}
                                    onChange={(value) => set('orderType', value)}
                                    choices={['pickup', 'delivery', 'dine_in'].map((value) => ({ value, label: t(`ops.orderType.${value}`) }))}
                                />
                                <Field label={t('ops.field.customerName')} value={form.customerName || ''} onChange={(value) => set('customerName', value)} />
                                <Field label={t('ops.field.phone')} value={form.phone || ''} onChange={(value) => set('phone', value)} keyboardType="phone-pad" />
                                {form.orderType === 'delivery' && <Field label={t('ops.field.address')} value={form.address || ''} onChange={(value) => set('address', value)} />}
                                {form.orderType === 'dine_in' && <Field label={t('ops.field.table')} value={form.tableNumber || ''} onChange={(value) => set('tableNumber', value)} />}
                            </>}
                            {kind === 'orders' && <>
                                <ReferencePicker label={t('ops.field.customerOptional')} items={secondary} value={selectedSecondary} onChange={setSelectedSecondary} emptyLabel={t('ops.create.noContacts')} />
                                <Field label={t('ops.field.paymentMethod')} value={form.paymentMethod || ''} onChange={(value) => set('paymentMethod', value)} />
                            </>}
                            <Field label={t('ops.field.notes')} value={form.notes || ''} onChange={(value) => set('notes', value)} multiline />
                        </>}

                        {kind === 'classes' && mode === 'book' && <>
                            <ReferencePicker label={t('ops.field.class')} items={primary} value={selectedPrimary} onChange={setSelectedPrimary} emptyLabel={t('ops.create.noClasses')} />
                            <ReferencePicker label={t('ops.field.member')} items={secondary} value={selectedSecondary} onChange={setSelectedSecondary} emptyLabel={t('ops.create.noMembers')} />
                        </>}
                        {kind === 'classes' && mode === 'create' && <>
                            <Field label={t('ops.field.className')} value={form.name || ''} onChange={(value) => set('name', value)} />
                            <Field label={t('ops.field.date')} value={form.date} onChange={(value) => set('date', value)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
                            <Field label={t('ops.field.time')} value={form.time} onChange={(value) => set('time', value)} placeholder="HH:mm" keyboardType="numbers-and-punctuation" />
                            <Field label={t('ops.field.capacity')} value={form.capacity} onChange={(value) => set('capacity', value)} keyboardType="numeric" />
                            <Field label={t('ops.field.duration')} value={form.duration} onChange={(value) => set('duration', value)} keyboardType="numeric" />
                            <Field label={t('ops.field.instructor')} value={form.instructor || ''} onChange={(value) => set('instructor', value)} />
                            <Field label={t('ops.field.room')} value={form.room || ''} onChange={(value) => set('room', value)} />
                        </>}

                        {kind === 'education' && <>
                            <ReferencePicker label={t('ops.field.cohort')} items={primary.filter((item) => ['open', undefined, null].includes(item.raw.status))} value={selectedPrimary} onChange={setSelectedPrimary} emptyLabel={t('ops.create.noCohorts')} />
                            <Field label={t('ops.field.studentName')} value={form.customerName || ''} onChange={(value) => set('customerName', value)} />
                            <Field label={t('ops.field.email')} value={form.email || ''} onChange={(value) => set('email', value)} keyboardType="email-address" />
                            <Field label={t('ops.field.phone')} value={form.phone || ''} onChange={(value) => set('phone', value)} keyboardType="phone-pad" />
                        </>}

                        {kind === 'insurance' && mode === 'quote' && <>
                            <ReferencePicker label={t('ops.field.plan')} items={primary} value={selectedPrimary} onChange={setSelectedPrimary} emptyLabel={t('ops.create.configurePlans')} />
                            <Field label={t('ops.field.applicantName')} value={form.customerName || ''} onChange={(value) => set('customerName', value)} />
                            <Field label={t('ops.field.age')} value={form.age || ''} onChange={(value) => set('age', value)} keyboardType="numeric" />
                            <Field label={t('ops.field.email')} value={form.email || ''} onChange={(value) => set('email', value)} keyboardType="email-address" />
                            <Field label={t('ops.field.phone')} value={form.phone || ''} onChange={(value) => set('phone', value)} keyboardType="phone-pad" />
                        </>}
                        {kind === 'insurance' && mode === 'claim' && <>
                            <ReferencePicker label={t('ops.field.policy')} items={secondary.filter((item) => item.raw.status === 'active' || !item.raw.status)} value={selectedSecondary} onChange={setSelectedSecondary} emptyLabel={t('ops.create.noPolicies')} />
                            <Field label={t('ops.field.incidentType')} value={form.incidentType || ''} onChange={(value) => set('incidentType', value)} />
                            <Field label={t('ops.field.incidentDate')} value={form.date} onChange={(value) => set('date', value)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
                            <Field label={t('ops.field.description')} value={form.description || ''} onChange={(value) => set('description', value)} multiline />
                            <Field label={t('ops.field.claimedAmount')} value={form.amount || ''} onChange={(value) => set('amount', value)} keyboardType="numeric" />
                        </>}
                        {kind === 'insurance' && mode === 'policy' && <>
                            <ReferencePicker label={t('ops.field.plan')} items={primary} value={selectedPrimary} onChange={setSelectedPrimary} emptyLabel={t('ops.create.configurePlans')} />
                            <Field label={t('ops.field.policyNumber')} value={form.policyNumber || ''} onChange={(value) => set('policyNumber', value)} />
                            <Field label={t('ops.field.policyholderName')} value={form.customerName || ''} onChange={(value) => set('customerName', value)} />
                            <Field label={t('ops.field.monthlyPremium')} value={form.amount || ''} onChange={(value) => set('amount', value)} keyboardType="numeric" />
                            <Field label={t('ops.field.startsAt')} value={form.startsAt} onChange={(value) => set('startsAt', value)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
                            <Field label={t('ops.field.endsAtOptional')} value={form.endDate} onChange={(value) => set('endDate', value)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
                        </>}

                        {kind === 'service_requests' && <>
                            <Field label={t('ops.field.serviceType')} value={form.serviceType || ''} onChange={(value) => set('serviceType', value)} />
                            <Choices label={t('ops.field.urgency')} value={form.urgency} onChange={(value) => set('urgency', value)} choices={['normal', 'alta', 'emergencia', 'flexible'].map((value) => ({ value, label: t(`ops.urgency.${value}`) }))} />
                            <Field label={t('ops.field.customerName')} value={form.customerName || ''} onChange={(value) => set('customerName', value)} />
                            <Field label={t('ops.field.phone')} value={form.phone || ''} onChange={(value) => set('phone', value)} keyboardType="phone-pad" />
                            <Field label={t('ops.field.address')} value={form.address || ''} onChange={(value) => set('address', value)} />
                            <Field label={t('ops.field.city')} value={form.city || ''} onChange={(value) => set('city', value)} />
                            <Field label={t('ops.field.preferredDate')} value={form.date} onChange={(value) => set('date', value)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
                            <Field label={t('ops.field.timeWindow')} value={form.timeWindow || ''} onChange={(value) => set('timeWindow', value)} />
                            <Field label={t('ops.field.description')} value={form.description || ''} onChange={(value) => set('description', value)} multiline />
                        </>}

                        {kind === 'photo_sessions' && <>
                            <Field label={t('ops.field.sessionType')} value={form.sessionType || ''} onChange={(value) => set('sessionType', value)} />
                            <Field label={t('ops.field.clientName')} value={form.customerName || ''} onChange={(value) => set('customerName', value)} />
                            <Field label={t('ops.field.phone')} value={form.phone || ''} onChange={(value) => set('phone', value)} keyboardType="phone-pad" />
                            <Field label={t('ops.field.date')} value={form.date} onChange={(value) => set('date', value)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
                            <Field label={t('ops.field.time')} value={form.time} onChange={(value) => set('time', value)} placeholder="HH:mm" keyboardType="numbers-and-punctuation" />
                            <Field label={t('ops.field.duration')} value={form.duration} onChange={(value) => set('duration', value)} keyboardType="numeric" />
                            <Field label={t('ops.field.location')} value={form.address || ''} onChange={(value) => set('address', value)} />
                            <Field label={t('ops.field.packageName')} value={form.packageName || ''} onChange={(value) => set('packageName', value)} />
                            <Field label={t('ops.field.price')} value={form.amount || ''} onChange={(value) => set('amount', value)} keyboardType="numeric" />
                            <Field label={t('ops.field.notes')} value={form.notes || ''} onChange={(value) => set('notes', value)} multiline />
                        </>}

                        {kind === 'test_drives' && <>
                            <ReferencePicker label={t('ops.field.vehicle')} items={primary} value={selectedPrimary} onChange={setSelectedPrimary} emptyLabel={t('ops.create.noVehicles')} />
                            <Field label={t('ops.field.customerName')} value={form.customerName || ''} onChange={(value) => set('customerName', value)} />
                            <Field label={t('ops.field.phone')} value={form.phone || ''} onChange={(value) => set('phone', value)} keyboardType="phone-pad" />
                            <Field label={t('ops.field.date')} value={form.date} onChange={(value) => set('date', value)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
                            <Field label={t('ops.field.time')} value={form.time} onChange={(value) => set('time', value)} placeholder="HH:mm" keyboardType="numbers-and-punctuation" />
                            <Field label={t('ops.field.notes')} value={form.notes || ''} onChange={(value) => set('notes', value)} multiline />
                        </>}

                        {(kind === 'vehicle_rentals' || kind === 'pet_boarding') && <>
                            <ReferencePicker label={t(kind === 'vehicle_rentals' ? 'ops.field.vehicle' : 'ops.field.pet')} items={primary} value={selectedPrimary} onChange={setSelectedPrimary} emptyLabel={t(kind === 'vehicle_rentals' ? 'ops.create.noVehicles' : 'ops.create.noPets')} />
                            {kind === 'pet_boarding' && <ReferencePicker label={t('ops.field.boardingService')} items={secondary} value={selectedSecondary} onChange={setSelectedSecondary} emptyLabel={t('ops.create.noBoardingServices')} />}
                            <Field label={t('ops.field.customerName')} value={form.customerName || ''} onChange={(value) => set('customerName', value)} />
                            <Field label={t('ops.field.phone')} value={form.phone || ''} onChange={(value) => set('phone', value)} keyboardType="phone-pad" />
                            <Field label={t(kind === 'vehicle_rentals' ? 'ops.field.pickupDate' : 'ops.field.checkIn')} value={form.date} onChange={(value) => set('date', value)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
                            <Field label={t(kind === 'vehicle_rentals' ? 'ops.field.returnDate' : 'ops.field.checkOut')} value={form.endDate} onChange={(value) => set('endDate', value)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
                            <Field label={t('ops.field.notes')} value={form.notes || ''} onChange={(value) => set('notes', value)} multiline />
                        </>}

                        {!!selectedPrimaryRow && kind === 'tours' && <Text style={styles.hint}>{selectedPrimaryRow.subtitle}</Text>}
                        {!!selectedSecondaryRow && kind === 'insurance' && mode === 'claim' && <Text style={styles.hint}>{selectedSecondaryRow.subtitle}</Text>}

                        <TouchableOpacity
                            style={[styles.submit, (!canSubmit || submitting || referenceError) && styles.disabled]}
                            onPress={() => void submit()}
                            disabled={!canSubmit || submitting || referenceError}
                            accessibilityRole="button"
                            accessibilityLabel={t('ops.create.submit')}
                        >
                            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{t('ops.create.submit')}</Text>}
                        </TouchableOpacity>
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
    headerText: { flex: 1 },
    title: { color: theme.text, fontSize: 20, fontWeight: '800' },
    subtitle: { color: theme.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
    close: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1 },
    content: { paddingHorizontal: 16, paddingTop: 10 },
    fieldWrap: { marginTop: 14 },
    label: { color: theme.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.45, marginBottom: 7 },
    input: { minHeight: 46, borderWidth: 1, borderColor: theme.border, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, color: theme.text, backgroundColor: theme.bgCard, fontSize: 14 },
    multiline: { minHeight: 88 },
    chipRow: { gap: 8, paddingRight: 16 },
    chip: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgCard },
    chipSelected: { borderColor: theme.accent, backgroundColor: theme.accent },
    chipText: { color: theme.textSecondary, fontSize: 13, fontWeight: '700' },
    chipTextSelected: { color: '#fff' },
    referenceRow: { gap: 8, paddingRight: 16 },
    referenceCard: { width: 178, minHeight: 62, justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgCard, padding: 10 },
    referenceSelected: { borderColor: theme.accent, backgroundColor: theme.accent + '20' },
    referenceTitle: { color: theme.text, fontSize: 13, fontWeight: '700' },
    referenceTitleSelected: { color: theme.accent },
    referenceSubtitle: { color: theme.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 3 },
    referenceSubtitleSelected: { color: theme.text },
    loader: { marginVertical: 20 },
    errorBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, backgroundColor: theme.danger + '18', borderRadius: 10, padding: 12, marginTop: 12 },
    errorText: { flex: 1, color: theme.danger, fontSize: 12 },
    retryText: { color: theme.accent, fontWeight: '800' },
    hint: { color: theme.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 7 },
    cartRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: theme.border, borderRadius: 11, backgroundColor: theme.bgCard, padding: 10, marginBottom: 8 },
    cartCopy: { flex: 1 },
    cartTitle: { color: theme.text, fontSize: 13, fontWeight: '700' },
    cartSubtitle: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
    qtyButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: theme.border },
    quantity: { width: 22, color: theme.text, textAlign: 'center', fontSize: 14, fontWeight: '800' },
    submit: { minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent, borderRadius: 12, marginTop: 24 },
    submitText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    disabled: { opacity: 0.45 },
});
