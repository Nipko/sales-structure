import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
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
    const { tenantId } = useAuth();
    const toast = useToast();
    const { t } = useI18n();
    const nav = useNavigation<NativeStackNavigationProp<CrmStackParams>>();
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState('');

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

    useEffect(() => { const t = setTimeout(load, search ? 350 : 0); return () => clearTimeout(t); }, [load, search]);

    if (loading) return <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>;

    return (
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
            <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color={theme.textSecondary} />
                <TextInput style={styles.search} placeholder={t('crm.searchLead')} placeholderTextColor={theme.textSecondary} value={search} onChangeText={setSearch} />
            </View>
            <FlatList
                data={leads}
                keyExtractor={(l) => l.id}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
                ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>{t('crm.empty')}</Text></View>}
                renderItem={({ item }) => (
                    <TouchableOpacity style={styles.row} onPress={() => nav.navigate('LeadDetail', { leadId: item.id, title: leadName(item) })}>
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
});
