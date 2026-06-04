import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, RefreshControl, ActivityIndicator, Modal } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { ListSkeleton } from '../components/Skeleton';
import { haptic } from '../lib/haptics';
import { theme } from '../theme';
import type { CrmStackParams } from '../navigation/RootNavigator';

interface Lead {
    id: string;
    first_name?: string;
    last_name?: string;
    name?: string;
    phone?: string;
    email?: string;
    stage?: string;
    score?: number;
    company_name?: string;
}

const STAGE_COLOR: Record<string, string> = {
    nuevo: '#95a5a6', contactado: '#3498db', respondio: '#9b59b6', calificado: '#e67e22',
    tibio: '#f39c12', caliente: '#e74c3c', listo_cierre: '#27ae60', ganado: '#2ecc71', perdido: '#7f8c8d',
};

function leadName(l: Lead): string {
    return l.name || `${l.first_name || ''} ${l.last_name || ''}`.trim() || l.phone || 'Lead';
}

export function CrmScreen() {
    const { tenantId, user } = useAuth();
    const toast = useToast();
    const { t } = useI18n();
    const nav = useNavigation<NativeStackNavigationProp<CrmStackParams>>();
    const route = useRoute<any>();
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState(route.params?.search || '');

    // Create-lead form
    const [createOpen, setCreateOpen] = useState(false);
    const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', email: '' });
    const [saving, setSaving] = useState(false);

    // Cross-navigation: another screen can jump here with a prefilled search term.
    useEffect(() => { if (route.params?.search) setSearch(route.params.search); }, [route.params?.search]);

    const load = useCallback(async () => {
        if (!tenantId) return;
        try {
            const res: any = await api.getLeads(tenantId, search ? `search=${encodeURIComponent(search)}&limit=50` : 'limit=50');
            if (res?.success) setLeads(Array.isArray(res.data) ? res.data : []);
        } catch {
            toast.error(t('common.loadError'));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [tenantId, search, toast, t]);

    useEffect(() => { const tm = setTimeout(load, search ? 350 : 0); return () => clearTimeout(tm); }, [load, search]);

    const createLead = async () => {
        if (!tenantId || !(form.first_name.trim() || form.phone.trim())) return;
        setSaving(true);
        try {
            const payload: Record<string, any> = { source: 'mobile' };
            if (form.first_name.trim()) payload.first_name = form.first_name.trim();
            if (form.last_name.trim()) payload.last_name = form.last_name.trim();
            if (form.phone.trim()) payload.phone = form.phone.trim();
            if (form.email.trim()) payload.email = form.email.trim();
            const r: any = await api.createLead(tenantId, payload);
            if (!r?.success) throw new Error('fail');
            toast.success(t('crm.leadCreated'));
            setCreateOpen(false);
            setForm({ first_name: '', last_name: '', phone: '', email: '' });
            if (r.data?.id) nav.navigate('LeadDetail', { leadId: r.data.id, title: leadName(r.data) });
            else load();
        } catch {
            toast.error(t('crm.leadCreateError'));
        } finally { setSaving(false); }
    };

    if (loading) return <View style={{ flex: 1, backgroundColor: theme.bg }}><ListSkeleton /></View>;

    return (
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
            <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color={theme.textSecondary} />
                <TextInput style={styles.search} placeholder={t('crm.searchLead')} placeholderTextColor={theme.textSecondary} value={search} onChangeText={setSearch} />
                {!!search && <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={16} color={theme.textSecondary} /></TouchableOpacity>}
            </View>
            <FlatList
                data={leads}
                keyExtractor={(l) => l.id}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
                ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>{search ? t('inbox.emptySearch', { q: search }) : t('crm.empty')}</Text></View>}
                contentContainerStyle={{ paddingBottom: 90 }}
                renderItem={({ item }) => (
                    <TouchableOpacity style={styles.row} onPress={() => nav.navigate('LeadDetail', { leadId: item.id, title: leadName(item) })}
                        accessibilityRole="button" accessibilityLabel={leadName(item)}>
                        <View style={[styles.avatar]}><Text style={styles.avatarText}>{leadName(item).charAt(0).toUpperCase()}</Text></View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.name} numberOfLines={1}>{leadName(item)}</Text>
                            <Text style={styles.sub} numberOfLines={1}>{item.company_name || item.phone || item.email || '—'}</Text>
                        </View>
                        {!!item.stage && (
                            <View style={[styles.stage, { backgroundColor: (STAGE_COLOR[item.stage] || theme.accent) + '22' }]}>
                                <Text style={[styles.stageText, { color: STAGE_COLOR[item.stage] || theme.accent }]}>{item.stage}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                )}
            />

            {/* Create-lead FAB */}
            <TouchableOpacity style={styles.fab} onPress={() => { haptic.tap(); setCreateOpen(true); }}
                accessibilityRole="button" accessibilityLabel={t('crm.newLead')}>
                <Ionicons name="add" size={28} color="#fff" />
            </TouchableOpacity>

            {/* Create-lead sheet */}
            <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
                <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setCreateOpen(false)}>
                    <View style={styles.sheet} onStartShouldSetResponder={() => true}>
                        <Text style={styles.sheetTitle}>{t('crm.newLead')}</Text>
                        <TextInput style={styles.input} placeholder={t('crm.firstName')} placeholderTextColor={theme.textSecondary}
                            value={form.first_name} onChangeText={(v) => setForm((f) => ({ ...f, first_name: v }))} />
                        <TextInput style={styles.input} placeholder={t('crm.lastName')} placeholderTextColor={theme.textSecondary}
                            value={form.last_name} onChangeText={(v) => setForm((f) => ({ ...f, last_name: v }))} />
                        <TextInput style={styles.input} placeholder={t('crm.field.phone')} placeholderTextColor={theme.textSecondary}
                            keyboardType="phone-pad" value={form.phone} onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))} />
                        <TextInput style={styles.input} placeholder={t('crm.email')} placeholderTextColor={theme.textSecondary}
                            keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={(v) => setForm((f) => ({ ...f, email: v }))} />
                        <Text style={styles.hint}>{t('crm.leadHint')}</Text>
                        <TouchableOpacity style={[styles.primaryBtn, (saving || !(form.first_name.trim() || form.phone.trim())) && { opacity: 0.5 }]}
                            onPress={createLead} disabled={saving || !(form.first_name.trim() || form.phone.trim())}>
                            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{t('crm.createLead')}</Text>}
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, backgroundColor: theme.bg },
    empty: { color: theme.textSecondary },
    searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1 },
    search: { flex: 1, color: theme.text, fontSize: 15 },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.accent + '33', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    avatarText: { color: theme.accent, fontWeight: '700', fontSize: 16 },
    name: { color: theme.text, fontSize: 15, fontWeight: '600' },
    sub: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
    stage: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    stageText: { fontSize: 11, fontWeight: '600' },
    fab: { position: 'absolute', right: 18, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.bgCard, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: '85%' },
    sheetTitle: { color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 12 },
    input: { backgroundColor: theme.bg, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: theme.text, fontSize: 15, marginBottom: 10 },
    hint: { color: theme.textSecondary, fontSize: 12, marginBottom: 8 },
    primaryBtn: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
    primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
