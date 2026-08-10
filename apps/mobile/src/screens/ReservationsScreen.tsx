/**
 * Operación para hotelería y alquiler vacacional.
 *
 * La pestaña de agenda mostraba citas de servicios (AppointmentsScreen) para
 * TODAS las verticales — para un tenant de apartamentos eso es un modelo ajeno:
 * acá lo que existe son ESTADÍAS sobre propiedades (property_bookings), con
 * check-in/check-out, huéspedes y precio por noche. RootNavigator elige esta
 * pantalla cuando verticalConfig.industry === 'turismo'.
 *
 * Crear reserva: el servidor valida disponibilidad (bloqueos iCal incluidos) y
 * calcula noches/precio — acá solo se recogen propiedad, fechas y huésped.
 * Cancelar: solo admin/supervisor (mismos roles que la API exige).
 */
import React, { useMemo, useState, useEffect } from 'react';
import {
    View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
    ActivityIndicator, Alert, Modal, ScrollView, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { PressableScale } from '../components/PressableScale';
import { haptic } from '../lib/haptics';
import { theme } from '../theme';
import { collectApiPages } from '../lib/pagination';

interface Stay {
    id: string;
    property_id: string;
    property_name?: string;
    guest_name?: string;
    guest_phone?: string;
    guests_count?: number;
    check_in: string;
    check_out: string;
    nights?: number;
    total_price?: string | number;
    currency?: string;
    status?: string;
}

interface Property {
    id: string;
    name: string;
    max_guests?: number;
    min_nights?: number;
}

interface Contact {
    id: string;
    name: string;
    phone?: string;
}

const STATUS_COLOR: Record<string, string> = {
    confirmed: theme.success,
    pending: theme.warning,
    cancelled: theme.danger,
};

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** '2026-08-12' → fecha local (evita el corrimiento UTC de new Date('YYYY-MM-DD')). */
function parseDay(s?: string): Date | null {
    if (!s) return null;
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    const parsed = new Date(y, m - 1, d);
    return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d
        ? parsed
        : null;
}

function fmtDay(s: string | undefined, locale: string): string {
    const d = parseDay(s);
    const localeTag: Record<string, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };
    return d ? d.toLocaleDateString(localeTag[locale] || 'es-CO', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
}

function fmtFullDay(s: string | undefined, locale: string): string {
    const d = parseDay(s);
    const localeTag: Record<string, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };
    return d ? d.toLocaleDateString(localeTag[locale] || 'es-CO', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }) : '—';
}

function nightsBetween(checkIn?: string, checkOut?: string): number {
    const start = parseDay(checkIn);
    const end = parseDay(checkOut);
    if (!start || !end) return 0;
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function money(v: string | number | undefined, currency: string | undefined, locale: string): string {
    const n = Number(v ?? 0);
    if (!n) return '';
    try {
        const localeTag: Record<string, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };
        return new Intl.NumberFormat(localeTag[locale] || 'es-CO', {
            style: 'currency', currency: currency || 'COP', maximumFractionDigits: 0,
        }).format(n);
    } catch {
        return `${n.toLocaleString()} ${currency || ''}`.trim();
    }
}

export function ReservationsScreen() {
    const { tenantId, user } = useAuth();
    const toast = useToast();
    const { t, locale } = useI18n();
    const insets = useSafeAreaInsets();
    const canCancel = user?.role === 'tenant_admin' || user?.role === 'tenant_supervisor' || user?.role === 'super_admin';
    const today = localDate(new Date());
    const [selectedStay, setSelectedStay] = useState<Stay | null>(null);
    const [cancellingId, setCancellingId] = useState('');

    const { data: stays, isLoading, isFetching, isError, refetch } = useQuery({
        queryKey: ['stays', tenantId],
        queryFn: async () => {
            if (!tenantId) return [] as Stay[];
            // Let the API resolve "today" in the tenant's timezone. The agent's
            // phone may be in a different country from the property.
            const res: any = await api.getUpcomingStays(tenantId);
            if (!res?.success) throw new Error(res?.error || 'load_failed');
            return (Array.isArray(res.data) ? res.data : []) as Stay[];
        },
        staleTime: 2 * 60 * 1000,
        enabled: !!tenantId,
        throwOnError: false,
    });

    // ── Crear estadía ────────────────────────────────────────────
    const [createOpen, setCreateOpen] = useState(false);
    const [cPropertyId, setCPropertyId] = useState('');
    const [cContactId, setCContactId] = useState('');
    const [cCheckIn, setCCheckIn] = useState('');
    const [cNights, setCNights] = useState('1');
    const [cGuestName, setCGuestName] = useState('');
    const [cGuestPhone, setCGuestPhone] = useState('');
    const [cGuests, setCGuests] = useState('2');
    const [creating, setCreating] = useState(false);
    const propertiesQuery = useQuery<Property[]>({
        queryKey: ['stay-properties', tenantId],
        queryFn: async () => {
            if (!tenantId) return [];
            const response: any = await api.getProperties(tenantId);
            if (!response?.success || !Array.isArray(response.data)) {
                throw new Error(response?.error || 'load_failed');
            }
            return response.data as Property[];
        },
        enabled: !!tenantId && createOpen,
        staleTime: 5 * 60 * 1000,
        throwOnError: false,
    });
    const properties = propertiesQuery.data || [];
    const contactsQuery = useQuery<Contact[]>({
        queryKey: ['stay-contacts', tenantId],
        queryFn: async () => {
            if (!tenantId) return [];
            const contacts = await collectApiPages<Contact>(
                (limit, offset) => api.getOrderContacts(tenantId, { limit, offset }),
            );
            return contacts.filter((contact) => contact?.id);
        },
        enabled: !!tenantId && createOpen,
        staleTime: 2 * 60 * 1000,
        throwOnError: false,
    });
    const contacts = contactsQuery.data || [];
    const selectedProperty = useMemo(
        () => properties.find((property) => property.id === cPropertyId),
        [properties, cPropertyId],
    );
    const minNights = Math.max(1, Number(selectedProperty?.min_nights || 1));
    const maxGuests = Math.max(1, Number(selectedProperty?.max_guests || 10));
    const nightsValue = Number(cNights);
    const guestsValue = Number(cGuests);
    const validNights = /^\d+$/.test(cNights) && Number.isSafeInteger(nightsValue) && nightsValue >= minNights;
    const validGuests = /^\d+$/.test(cGuests) && Number.isSafeInteger(guestsValue)
        && guestsValue >= 1 && guestsValue <= maxGuests;
    const validCheckIn = !!parseDay(cCheckIn) && cCheckIn >= today;
    const canCreate = !!tenantId && !!cContactId && !!cPropertyId && validCheckIn
        && validNights && validGuests && !!cGuestName.trim();

    useEffect(() => {
        if (properties.length === 1 && !cPropertyId) setCPropertyId(properties[0].id);
    }, [properties, cPropertyId]);

    useEffect(() => {
        if (contacts.length !== 1 || cContactId) return;
        const contact = contacts[0];
        setCContactId(contact.id);
        setCGuestName(contact.name || '');
        setCGuestPhone(contact.phone || '');
    }, [contacts, cContactId]);

    useEffect(() => {
        if (!selectedProperty) return;
        setCNights((current) => String(Math.max(Number(current) || 0, minNights)));
        setCGuests((current) => String(Math.min(Math.max(1, Number(current) || 1), maxGuests)));
    }, [selectedProperty, minNights, maxGuests]);

    const openCreate = () => {
        haptic.tap();
        setCContactId(''); setCCheckIn(''); setCNights('1'); setCGuestName(''); setCGuestPhone(''); setCGuests('2');
        setCreateOpen(true);
    };

    const checkOutOf = (checkIn: string, nights: number): string => {
        const d = parseDay(checkIn);
        if (!d) return '';
        d.setDate(d.getDate() + nights);
        return localDate(d);
    };

    const createStay = async () => {
        if (!canCreate || !tenantId) return;
        setCreating(true);
        try {
            const r: any = await api.createPropertyBooking(tenantId, cPropertyId, {
                contactId: cContactId,
                checkIn: cCheckIn,
                checkOut: checkOutOf(cCheckIn, nightsValue),
                guestName: cGuestName.trim(),
                guestPhone: cGuestPhone.trim() || undefined,
                guestsCount: guestsValue,
            });
            if (!r?.success) {
                const unavailable = /not available|conflict|ocupad|disponib/i.test(String(r?.error || ''));
                toast.error(t(unavailable ? 'stays.unavailable' : 'stays.createError'));
                return;
            }
            toast.success(t('stays.created'));
            haptic.success();
            setCreateOpen(false);
            await refetch();
        } catch { toast.error(t('stays.createError')); }
        finally { setCreating(false); }
    };

    const cancelStay = (s: Stay) => {
        if (!canCancel || cancellingId) return;
        Alert.alert(t('stays.cancelTitle'), t('stays.cancelConfirm', { name: s.guest_name || t('stays.guest') }), [
            { text: t('citas.no'), style: 'cancel' },
            { text: t('citas.yesCancel'), style: 'destructive', onPress: async () => {
                setCancellingId(s.id);
                try {
                    const r: any = await api.cancelPropertyBooking(tenantId!, s.id);
                    if (!r?.success) throw new Error('fail');
                    toast.success(t('stays.cancelled'));
                    setSelectedStay(null);
                    await refetch();
                } catch { toast.error(t('stays.cancelError')); }
                finally { setCancellingId(''); }
            } },
        ]);
    };

    const dateChips = Array.from({ length: 30 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });
    const nightChoices = Array.from(new Set([minNights, 1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 30]))
        .filter((n) => n >= minNights)
        .sort((a, b) => a - b);
    const guestChoices = Array.from(new Set([1, 2, 3, 4, 5, 6, maxGuests]))
        .filter((n) => n <= maxGuests)
        .sort((a, b) => a - b);

    if (isLoading) return <SafeAreaView style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></SafeAreaView>;

    if (isError && !stays) return (
        <SafeAreaView style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={40} color={theme.textSecondary} />
            <Text style={[styles.empty, { marginTop: 10 }]}>{t('stays.loadError')}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
        </SafeAreaView>
    );

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>
            <Text style={styles.h1}>{t('stays.title')}</Text>
            <FlatList
                data={stays || []}
                keyExtractor={(s) => s.id}
                contentContainerStyle={{ paddingBottom: 90 }}
                refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={() => refetch()} tintColor={theme.accent} />}
                ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>{t('stays.empty')}</Text></View>}
                renderItem={({ item }) => {
                    const inHouse = item.check_in <= today && item.check_out > today;
                    const st = item.status || 'confirmed';
                    return (
                        <PressableScale style={styles.card}
                            accessibilityRole="button"
                            accessibilityLabel={`${item.property_name || ''} · ${item.guest_name || ''}`}
                            onLongPress={canCancel ? () => cancelStay(item) : undefined}
                            onPress={() => { haptic.tap(); setSelectedStay(item); }}>
                            <View style={styles.datesCol}>
                                <Text style={[styles.day, inHouse && { color: theme.success }]}>{fmtDay(item.check_in, locale)}</Text>
                                <Ionicons name="arrow-down" size={11} color={theme.textSecondary} style={{ marginVertical: 1 }} />
                                <Text style={styles.day}>{fmtDay(item.check_out, locale)}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.property} numberOfLines={1}>{item.property_name || t('stays.property')}</Text>
                                <Text style={styles.guest} numberOfLines={1}>
                                    {item.guest_name || t('stays.guest')}
                                    {item.guests_count ? `  ·  ${item.guests_count} ${t('stays.pax')}` : ''}
                                </Text>
                                <View style={styles.badgeRow}>
                                    {inHouse && (
                                        <View style={[styles.badge, { backgroundColor: theme.success + '22' }]}>
                                            <Text style={[styles.badgeText, { color: theme.success }]}>{t('stays.inHouse')}</Text>
                                        </View>
                                    )}
                                    <View style={[styles.badge, { backgroundColor: (STATUS_COLOR[st] || theme.textSecondary) + '22' }]}>
                                        <Text style={[styles.badgeText, { color: STATUS_COLOR[st] || theme.textSecondary }]}>{t(`ops.status.${st}`)}</Text>
                                    </View>
                                    {!!item.nights && <Text style={styles.meta}>{item.nights} {t('stays.nights')}</Text>}
                                    {!!money(item.total_price, item.currency, locale) && <Text style={styles.meta}>{money(item.total_price, item.currency, locale)}</Text>}
                                </View>
                            </View>
                            {canCancel && (
                                <TouchableOpacity onPress={(event) => { event.stopPropagation(); cancelStay(item); }}
                                    disabled={cancellingId === item.id}
                                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                    accessibilityRole="button" accessibilityLabel={t('stays.cancelA11y', { name: item.guest_name || '' })}>
                                    {cancellingId === item.id
                                        ? <ActivityIndicator size="small" color={theme.textSecondary} />
                                        : <Ionicons name="close-circle-outline" size={24} color={theme.textSecondary} />}
                                </TouchableOpacity>
                            )}
                        </PressableScale>
                    );
                }}
            />

            {/* Crear estadía directa */}
            <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 18 }]} onPress={openCreate} accessibilityRole="button" accessibilityLabel={t('stays.new')}>
                <Ionicons name="add" size={28} color="#fff" />
            </TouchableOpacity>

            {/* Detalle operativo de la estadía */}
            <Modal visible={!!selectedStay} transparent animationType="slide" onRequestClose={() => setSelectedStay(null)} statusBarTranslucent>
                <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSelectedStay(null)}>
                    <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onStartShouldSetResponder={() => true}>
                        {selectedStay && (
                            <ScrollView>
                                <Text style={styles.sheetTitle}>{selectedStay.property_name || t('stays.property')}</Text>
                                <DetailRow label={t('stays.guest')} value={selectedStay.guest_name || '—'} />
                                <DetailRow label={t('stays.guestPhone')} value={selectedStay.guest_phone || '—'} />
                                <DetailRow label={t('stays.checkIn')} value={fmtFullDay(selectedStay.check_in, locale)} />
                                <DetailRow label={t('stays.checkOut')} value={fmtFullDay(selectedStay.check_out, locale)} />
                                <DetailRow
                                    label={t('stays.nightsLabel')}
                                    value={String(selectedStay.nights || nightsBetween(selectedStay.check_in, selectedStay.check_out) || '—')}
                                />
                                <DetailRow label={t('stays.paxLabel')} value={String(selectedStay.guests_count || '—')} />
                                <DetailRow label={t('ops.detail.status')} value={t(`ops.status.${selectedStay.status || 'confirmed'}`)} />
                                <DetailRow label={t('ops.detail.amount')} value={money(selectedStay.total_price, selectedStay.currency, locale) || '—'} />

                                {canCancel && selectedStay.status !== 'cancelled' && (
                                    <TouchableOpacity
                                        style={[styles.cancelDetailButton, cancellingId === selectedStay.id && { opacity: 0.5 }]}
                                        onPress={() => cancelStay(selectedStay)}
                                        disabled={!!cancellingId}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('stays.cancelA11y', { name: selectedStay.guest_name || '' })}
                                    >
                                        {cancellingId === selectedStay.id
                                            ? <ActivityIndicator color={theme.danger} />
                                            : <>
                                                <Ionicons name="close-circle-outline" size={19} color={theme.danger} />
                                                <Text style={styles.cancelDetailText}>{t('citas.cancelBtn')}</Text>
                                            </>}
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity style={styles.closeDetailButton} onPress={() => setSelectedStay(null)} accessibilityRole="button">
                                    <Text style={styles.closeDetailText}>{t('common.close')}</Text>
                                </TouchableOpacity>
                            </ScrollView>
                        )}
                    </View>
                </TouchableOpacity>
            </Modal>

            <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)} statusBarTranslucent>
                <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setCreateOpen(false)}>
                    <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onStartShouldSetResponder={() => true}>
                        <ScrollView keyboardShouldPersistTaps="handled">
                            <Text style={styles.sheetTitle}>{t('stays.new')}</Text>

                            <Text style={styles.sectionLabel}>{t('stays.contact')}</Text>
                            {contactsQuery.isLoading ? (
                                <ActivityIndicator color={theme.accent} style={{ marginVertical: 8 }} />
                            ) : contactsQuery.isError ? (
                                <View style={styles.propertiesError}>
                                    <Text style={styles.empty}>{t('stays.contactsLoadError')}</Text>
                                    <TouchableOpacity onPress={() => contactsQuery.refetch()} accessibilityRole="button">
                                        <Text style={styles.retryLink}>{t('common.retry')}</Text>
                                    </TouchableOpacity>
                                </View>
                            ) : contacts.length ? (
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                                    {contacts.map((contact) => {
                                        const selected = cContactId === contact.id;
                                        return (
                                            <TouchableOpacity
                                                key={contact.id}
                                                onPress={() => {
                                                    haptic.tap();
                                                    setCContactId(contact.id);
                                                    setCGuestName(contact.name || '');
                                                    setCGuestPhone(contact.phone || '');
                                                }}
                                                accessibilityRole="button"
                                                accessibilityState={{ selected }}
                                                style={[styles.chip, selected && styles.chipOn]}
                                            >
                                                <Text style={[styles.chipText, selected && { color: '#fff' }]} numberOfLines={1}>{contact.name}</Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </ScrollView>
                            ) : (
                                <Text style={styles.empty}>{t('stays.noContacts')}</Text>
                            )}

                            <Text style={styles.sectionLabel}>{t('stays.property')}</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                                {propertiesQuery.isLoading && <ActivityIndicator color={theme.accent} style={{ marginVertical: 8 }} />}
                                {propertiesQuery.isError && (
                                    <View style={styles.propertiesError}>
                                        <Text style={styles.empty}>{t('stays.propertiesLoadError')}</Text>
                                        <TouchableOpacity onPress={() => propertiesQuery.refetch()} accessibilityRole="button">
                                            <Text style={styles.retryLink}>{t('common.retry')}</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                                {!propertiesQuery.isLoading && !propertiesQuery.isError && properties.map((p) => (
                                    <TouchableOpacity key={p.id} onPress={() => { haptic.tap(); setCPropertyId(p.id); }}
                                        accessibilityRole="button" accessibilityState={{ selected: cPropertyId === p.id }}
                                        style={[styles.chip, cPropertyId === p.id && styles.chipOn]}>
                                        <Text style={[styles.chipText, cPropertyId === p.id && { color: '#fff' }]} numberOfLines={1}>{p.name}</Text>
                                    </TouchableOpacity>
                                ))}
                                {!propertiesQuery.isLoading && !propertiesQuery.isError && !properties.length && <Text style={styles.empty}>{t('stays.noProperties')}</Text>}
                            </ScrollView>

                            <Text style={styles.sectionLabel}>{t('stays.checkIn')}</Text>
                            <TextInput
                                style={styles.input}
                                placeholder={t('stays.datePlaceholder')}
                                placeholderTextColor={theme.textSecondary}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="numbers-and-punctuation"
                                maxLength={10}
                                value={cCheckIn}
                                onChangeText={(value) => setCCheckIn(value.replace(/[^0-9-]/g, '').slice(0, 10))}
                            />
                            {!!cCheckIn && !validCheckIn && <Text style={[styles.hint, { color: theme.danger }]}>{t('stays.invalidDate')}</Text>}
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                                {dateChips.map((d) => {
                                    const ds = localDate(d);
                                    const on = ds === cCheckIn;
                                    return (
                                        <TouchableOpacity key={ds} onPress={() => { haptic.tap(); setCCheckIn(ds); }}
                                            accessibilityRole="button" accessibilityState={{ selected: on }}
                                            style={[styles.chip, on && styles.chipOn]}>
                                            <Text style={[styles.chipText, on && { color: '#fff' }]}>
                                                {fmtDay(ds, locale)}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>

                            <Text style={styles.sectionLabel}>{t('stays.nightsLabel')}</Text>
                            <TextInput
                                style={styles.input}
                                keyboardType="number-pad"
                                value={cNights}
                                onChangeText={(value) => setCNights(value.replace(/\D/g, ''))}
                                accessibilityLabel={t('stays.nightsLabel')}
                            />
                            {!!cNights && !validNights && <Text style={[styles.hint, { color: theme.danger }]}>{t('stays.nightsLabel')}: {minNights}+</Text>}
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                                {nightChoices.map((n) => (
                                    <TouchableOpacity key={n} onPress={() => { haptic.tap(); setCNights(String(n)); }}
                                        accessibilityRole="button" accessibilityState={{ selected: nightsValue === n }}
                                        style={[styles.chip, nightsValue === n && styles.chipOn]}>
                                        <Text style={[styles.chipText, nightsValue === n && { color: '#fff' }]}>{n}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                            {!!cCheckIn && validNights && (
                                <Text style={styles.hint}>{t('stays.checkOut')}: {fmtDay(checkOutOf(cCheckIn, nightsValue), locale)}</Text>
                            )}

                            <Text style={styles.sectionLabel}>{t('stays.guest')}</Text>
                            <TextInput style={styles.input} placeholder={t('stays.guestName')} placeholderTextColor={theme.textSecondary}
                                value={cGuestName} onChangeText={setCGuestName} />
                            <TextInput style={[styles.input, { marginTop: 8 }]} placeholder={t('stays.guestPhone')} placeholderTextColor={theme.textSecondary}
                                keyboardType="phone-pad" value={cGuestPhone} onChangeText={setCGuestPhone} />

                            <Text style={styles.sectionLabel}>{t('stays.paxLabel')}</Text>
                            <TextInput
                                style={styles.input}
                                keyboardType="number-pad"
                                value={cGuests}
                                onChangeText={(value) => setCGuests(value.replace(/\D/g, ''))}
                                accessibilityLabel={t('stays.paxLabel')}
                            />
                            {!!cGuests && !validGuests && <Text style={[styles.hint, { color: theme.danger }]}>{t('stays.paxLabel')}: 1–{maxGuests}</Text>}
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                                {guestChoices.map((n) => (
                                    <TouchableOpacity key={n} onPress={() => { haptic.tap(); setCGuests(String(n)); }}
                                        accessibilityRole="button" accessibilityState={{ selected: guestsValue === n }}
                                        style={[styles.chip, guestsValue === n && styles.chipOn]}>
                                        <Text style={[styles.chipText, guestsValue === n && { color: '#fff' }]}>{n}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>

                            <TouchableOpacity
                                style={[styles.primaryBtn, (creating || !canCreate) && { opacity: 0.5 }]}
                                onPress={createStay}
                                disabled={creating || !canCreate}
                                accessibilityRole="button" accessibilityLabel={t('stays.create')}>
                                {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{t('stays.create')}</Text>}
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                </TouchableOpacity>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={styles.detailValue}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, backgroundColor: theme.bg },
    empty: { color: theme.textSecondary },
    retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, backgroundColor: theme.accent, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
    retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    propertiesError: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    retryLink: { color: theme.accent, fontSize: 13, fontWeight: '700' },
    h1: { color: theme.text, fontSize: 24, fontWeight: '700', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
    card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginHorizontal: 12, marginBottom: 8, borderRadius: 12, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1 },
    datesCol: { alignItems: 'center', minWidth: 74 },
    day: { color: theme.text, fontSize: 12, fontWeight: '600' },
    property: { color: theme.text, fontSize: 15, fontWeight: '700' },
    guest: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
    badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
    badgeText: { fontSize: 10, fontWeight: '700' },
    meta: { color: theme.textSecondary, fontSize: 11 },
    fab: { position: 'absolute', right: 18, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', elevation: 5 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.bgCard, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: '88%' },
    sheetTitle: { color: theme.text, fontSize: 17, fontWeight: '700' },
    sectionLabel: { color: theme.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
    chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg, maxWidth: 220 },
    chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.textSecondary, fontSize: 13, fontWeight: '600' },
    hint: { color: theme.textSecondary, fontSize: 12, marginTop: 8 },
    input: { backgroundColor: theme.bg, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: theme.text, fontSize: 14 },
    primaryBtn: { backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
    primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.border },
    detailLabel: { color: theme.textSecondary, fontSize: 13, flexShrink: 0 },
    detailValue: { color: theme.text, fontSize: 13, fontWeight: '600', textAlign: 'right', flex: 1 },
    cancelDetailButton: { marginTop: 18, minHeight: 46, borderWidth: 1, borderColor: theme.danger, borderRadius: 11, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
    cancelDetailText: { color: theme.danger, fontSize: 14, fontWeight: '700' },
    closeDetailButton: { marginTop: 10, minHeight: 46, borderRadius: 11, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
    closeDetailText: { color: theme.text, fontSize: 14, fontWeight: '700' },
});
