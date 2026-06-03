import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Image, ScrollView, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { getInboxSocket, getAgentSocket, onInboxStatus, getInboxStatus, type SocketStatus } from '../lib/socket';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { theme, channelColor } from '../theme';
import type { InboxStackParams } from '../navigation/RootNavigator';

interface Conv {
    id: string;
    contactName: string;
    contactAvatar?: string;
    lastMessage: string;
    lastMessageAt?: string;
    status: string;
    channel: string;
    assignedAgentId?: string | null;
    isAiHandled?: boolean;
    unreadCount?: number;
    handoffReason?: string | null;
}

const FILTERS = [
    { key: 'all', label: 'Todas' },
    { key: 'mine', label: 'Mías' },
    { key: 'unassigned', label: 'Sin asignar' },
    { key: 'handoff', label: 'Handoff' },
] as const;

const CHANNEL_ICON: Record<string, any> = {
    whatsapp: 'logo-whatsapp', instagram: 'logo-instagram', messenger: 'logo-facebook',
    telegram: 'paper-plane', sms: 'chatbox', email: 'mail', web_widget: 'globe',
};

function relTime(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso).getTime();
    const diff = Date.now() - d;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'ahora';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days}d`;
    return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function InboxScreen() {
    const { tenantId } = useAuth();
    const toast = useToast();
    const { t } = useI18n();
    const nav = useNavigation<NativeStackNavigationProp<InboxStackParams>>();
    const [items, setItems] = useState<Conv[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(false);
    const [filter, setFilter] = useState<string>('all');
    const [search, setSearch] = useState('');
    const [live, setLive] = useState<SocketStatus>(getInboxStatus());

    useEffect(() => onInboxStatus(setLive), []);

    // `silent` = background reload (socket event / pull-refresh): no spinner, no error view,
    // just a toast if it fails so a stale list isn't mistaken for fresh.
    const load = useCallback(async (silent = false) => {
        if (!tenantId) return;
        try {
            const res: any = await api.getInbox(tenantId, filter === 'all' ? undefined : filter);
            const list = Array.isArray(res?.data) ? res.data : (res?.data?.conversations || []);
            if (res?.success) setItems(list);
            setError(false);
        } catch {
            if (silent) toast.error(t('inbox.refreshError'));
            else setError(true);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [tenantId, filter, toast, t]);

    const retry = useCallback(() => { setLoading(true); setError(false); load(); }, [load]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const reload = () => load(true); // background: don't blank the list / show error view
        // /inbox → live customer/AI messages; /agent → handoff, assign, resolve.
        const inbox = getInboxSocket();
        const agent = getAgentSocket();
        inbox.on('newMessage', reload);
        inbox.on('conversationUpdated', reload);
        agent.on('inbox:refresh', reload);
        agent.on('inbox:handoff', reload);
        return () => {
            inbox.off('newMessage', reload);
            inbox.off('conversationUpdated', reload);
            agent.off('inbox:refresh', reload);
            agent.off('inbox:handoff', reload);
        };
    }, [load]);

    const q = search.trim().toLowerCase();
    const visible = q
        ? items.filter((c) => (c.contactName || '').toLowerCase().includes(q) || (c.lastMessage || '').toLowerCase().includes(q))
        : items;

    return (
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
            {/* Live connection status */}
            <View style={styles.statusBar}>
                <View style={[styles.dot, { backgroundColor: live === 'connected' ? theme.success : live === 'connecting' ? theme.warning : theme.danger }]} />
                <Text style={styles.statusText}>
                    {live === 'connected' ? t('inbox.live.connected') : live === 'connecting' ? t('inbox.live.connecting') : t('inbox.live.offline')}
                </Text>
            </View>

            {/* Search */}
            <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color={theme.textSecondary} />
                <TextInput style={styles.search} placeholder={t('inbox.search')} placeholderTextColor={theme.textSecondary} value={search} onChangeText={setSearch} />
                {!!search && <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={16} color={theme.textSecondary} /></TouchableOpacity>}
            </View>

            {/* Filters */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }}>
                {FILTERS.map((f) => (
                    <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)}
                        style={[styles.filterChip, filter === f.key && styles.filterChipOn]}>
                        <Text style={[styles.filterText, filter === f.key && { color: '#fff' }]}>{t(`inbox.filter.${f.key}`)}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            {loading ? (
                <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>
            ) : error && visible.length === 0 ? (
                <View style={styles.center}>
                    <Ionicons name="cloud-offline-outline" size={40} color={theme.textSecondary} />
                    <Text style={[styles.empty, { marginTop: 10 }]}>{t('inbox.error')}</Text>
                    <TouchableOpacity style={styles.retryBtn} onPress={retry} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
                        <Ionicons name="refresh" size={16} color="#fff" />
                        <Text style={styles.retryText}>{t('common.retry')}</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={visible}
                    keyExtractor={(c) => c.id}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={theme.accent} />}
                    ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>{t('inbox.empty')}</Text></View>}
                    renderItem={({ item }) => {
                        const ch = item.channel || 'whatsapp';
                        const color = channelColor[ch] || theme.accent;
                        const waiting = item.status === 'waiting_human' || item.status === 'with_human';
                        return (
                            <TouchableOpacity
                                style={styles.row}
                                onPress={() => nav.navigate('Conversation', { conversationId: item.id, title: item.contactName })}
                            >
                                {/* Avatar with channel badge */}
                                <View>
                                    {item.contactAvatar ? (
                                        <Image source={{ uri: item.contactAvatar }} style={styles.avatar} />
                                    ) : (
                                        <View style={styles.avatar}><Text style={styles.avatarText}>{(item.contactName || '?').charAt(0).toUpperCase()}</Text></View>
                                    )}
                                    <View style={[styles.chBadge, { backgroundColor: color }]}>
                                        <Ionicons name={CHANNEL_ICON[ch] || 'chatbox'} size={9} color="#fff" />
                                    </View>
                                </View>

                                <View style={{ flex: 1 }}>
                                    <View style={styles.rowTop}>
                                        <Text style={styles.name} numberOfLines={1}>{item.contactName || t('inbox.customer')}</Text>
                                        <Text style={styles.time}>{relTime(item.lastMessageAt)}</Text>
                                    </View>
                                    <View style={styles.rowBottom}>
                                        <Text style={styles.preview} numberOfLines={1}>{item.lastMessage || '—'}</Text>
                                        {waiting && <View style={styles.handoffBadge}><Text style={styles.handoffText}>Handoff</Text></View>}
                                        {!waiting && item.isAiHandled && <Ionicons name="sparkles" size={12} color={theme.accent} style={{ marginLeft: 6 }} />}
                                        {!!item.unreadCount && item.unreadCount > 0 && (
                                            <View style={styles.unread}><Text style={styles.unreadText}>{item.unreadCount}</Text></View>
                                        )}
                                    </View>
                                </View>
                            </TouchableOpacity>
                        );
                    }}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    statusBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 8 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { color: theme.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, backgroundColor: theme.bg },
    empty: { color: theme.textSecondary, fontSize: 14 },
    retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, backgroundColor: theme.accent, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
    retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 10, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1 },
    search: { flex: 1, color: theme.text, fontSize: 15 },
    filters: { maxHeight: 52, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgCard },
    filterChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    filterText: { color: theme.textSecondary, fontSize: 13, fontWeight: '600' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.accent + '33', alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: theme.accent, fontWeight: '700', fontSize: 18 },
    chBadge: { position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.bg },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    name: { color: theme.text, fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
    time: { color: theme.textSecondary, fontSize: 12 },
    rowBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
    preview: { color: theme.textSecondary, fontSize: 13, flex: 1 },
    handoffBadge: { backgroundColor: theme.warning + '22', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, marginLeft: 6 },
    handoffText: { color: theme.warning, fontSize: 10, fontWeight: '700' },
    unread: { backgroundColor: theme.accent, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginLeft: 8, paddingHorizontal: 6 },
    unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
