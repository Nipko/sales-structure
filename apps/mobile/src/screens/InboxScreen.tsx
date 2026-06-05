import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Image, ScrollView, TextInput, Alert, Animated, PanResponder } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { getInboxSocket, getAgentSocket, onInboxStatus, getInboxStatus, type SocketStatus } from '../lib/socket';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { ListSkeleton } from '../components/Skeleton';
import { haptic } from '../lib/haptics';
import { setUnreadTotal } from '../lib/unread';
import { snoozeUntil } from '../lib/snooze';
import { theme, channelColor, channelLabel } from '../theme';
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
    { key: 'resolved', label: 'Resueltas' },
] as const;

const CHANNEL_ICON: Record<string, any> = {
    whatsapp: 'logo-whatsapp', instagram: 'logo-instagram', messenger: 'logo-facebook',
    telegram: 'paper-plane', sms: 'chatbox', email: 'mail', web_widget: 'globe',
};

function relTime(iso?: string, nowLabel = ''): string {
    if (!iso) return '';
    const d = new Date(iso).getTime();
    const diff = Date.now() - d;
    const m = Math.floor(diff / 60000);
    if (m < 1) return nowLabel;
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days}d`;
    return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** Pure-JS swipe-to-reveal (no native gesture-handler): swipe a row left to
 *  expose Posponer + Resolver. Coexists with tap (open) and long-press (menu). */
function SwipeableRow({ children, onResolve, onSnooze }: { children: React.ReactNode; onResolve: () => void; onSnooze: () => void }) {
    const tx = useRef(new Animated.Value(0)).current;
    const openRef = useRef(false);
    const REVEAL = 140;
    const pan = useRef(PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_e, g) => {
            let v = (openRef.current ? -REVEAL : 0) + g.dx;
            if (v > 0) v = 0; if (v < -REVEAL - 30) v = -REVEAL - 30;
            tx.setValue(v);
        },
        onPanResponderRelease: (_e, g) => {
            const shouldOpen = openRef.current ? g.dx < 40 : g.dx < -50;
            openRef.current = shouldOpen;
            Animated.spring(tx, { toValue: shouldOpen ? -REVEAL : 0, useNativeDriver: true, bounciness: 0 }).start();
        },
    })).current;
    const close = () => { openRef.current = false; Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(); };
    return (
        <View style={styles.swipeWrap}>
            <View style={styles.swipeActions}>
                <TouchableOpacity style={[styles.swipeBtn, { backgroundColor: theme.warning }]} onPress={() => { close(); onSnooze(); }} accessibilityRole="button">
                    <Ionicons name="moon-outline" size={20} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.swipeBtn, { backgroundColor: theme.success }]} onPress={() => { close(); onResolve(); }} accessibilityRole="button">
                    <Ionicons name="checkmark-done-outline" size={20} color="#fff" />
                </TouchableOpacity>
            </View>
            <Animated.View style={{ transform: [{ translateX: tx }], backgroundColor: theme.bg }} {...pan.panHandlers}>
                {children}
            </Animated.View>
        </View>
    );
}

export function InboxScreen() {
    const { tenantId, user } = useAuth();
    const toast = useToast();
    const { t } = useI18n();
    const nav = useNavigation<NativeStackNavigationProp<InboxStackParams>>();
    const [items, setItems] = useState<Conv[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(false);
    const [filter, setFilter] = useState<string>('all');
    const [channelFilter, setChannelFilter] = useState<string>('all');
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [search, setSearch] = useState('');
    const [live, setLive] = useState<SocketStatus>(getInboxStatus());

    useEffect(() => onInboxStatus(setLive), []);

    const pickFilter = useCallback((key: string) => { haptic.tap(); setFilter(key); }, []);

    // `silent` = background reload (socket event / pull-refresh): no spinner, no error view,
    // just a toast if it fails so a stale list isn't mistaken for fresh.
    const load = useCallback(async (silent = false) => {
        if (!tenantId) return;
        try {
            const res: any = await api.getInbox(tenantId, filter === 'all' ? undefined : filter);
            const list = Array.isArray(res?.data) ? res.data : (res?.data?.conversations || []);
            if (res?.success) {
                setItems(list);
                // Publish total unread so the Inbox tab can show a badge (QW5).
                setUnreadTotal(list.reduce((sum: number, c: Conv) => sum + (c.unreadCount || 0), 0));
            }
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

    // Quick triage from the list: long-press a row → assign / resolve / snooze,
    // optimistic (row leaves immediately) + an Undo toast for the destructive ones.
    const doQuick = useCallback(async (item: Conv, action: 'assign' | 'resolve' | 'snooze') => {
        if (!tenantId) return;
        if (action === 'assign') {
            if (!user?.id) return;
            try { await api.assignConversation(tenantId, item.id, user.id); toast.success(t('inbox.qa.assigned')); load(true); }
            catch { toast.error(t('conv.assignError')); }
            return;
        }
        const snapshot = items;
        setItems((prev) => prev.filter((c) => c.id !== item.id)); // optimistic remove
        if (action === 'resolve') {
            try {
                await api.resolveConversation(tenantId, item.id, user?.id);
                toast.success(t('conv.resolved'), { label: t('common.undo'), onPress: () =>
                    api.reopenConversation(tenantId, item.id).then(() => load(true)).catch(() => toast.error(t('common.undoError'))) });
            } catch { setItems(snapshot); toast.error(t('conv.resolveError')); }
        } else {
            try {
                await api.snoozeConversation(tenantId, item.id, snoozeUntil('tomorrow').toISOString());
                toast.success(t('conv.snoozed'), { label: t('common.undo'), onPress: () =>
                    api.unsnoozeConversation(tenantId, item.id).then(() => load(true)).catch(() => toast.error(t('common.undoError'))) });
            } catch { setItems(snapshot); toast.error(t('conv.snoozeError')); }
        }
    }, [tenantId, user?.id, items, toast, t, load]);

    const openQuickActions = useCallback((item: Conv) => {
        haptic.tap();
        Alert.alert(item.contactName || t('inbox.customer'), undefined, [
            { text: t('inbox.qa.assign'), onPress: () => doQuick(item, 'assign') },
            { text: t('inbox.qa.snooze'), onPress: () => doQuick(item, 'snooze') },
            { text: t('inbox.qa.resolve'), style: 'destructive', onPress: () => doQuick(item, 'resolve') },
            { text: t('common.cancel'), style: 'cancel' },
        ]);
    }, [doQuick, t]);

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

    // Channels actually present in the loaded list → drive the channel filter chips.
    const channelsPresent = Array.from(new Set(items.map((c) => c.channel || 'whatsapp')));

    const q = search.trim().toLowerCase();
    const visible = items.filter((c) => {
        if (channelFilter !== 'all' && (c.channel || 'whatsapp') !== channelFilter) return false;
        if (unreadOnly && !(c.unreadCount && c.unreadCount > 0)) return false;
        if (q && !((c.contactName || '').toLowerCase().includes(q) || (c.lastMessage || '').toLowerCase().includes(q))) return false;
        return true;
    });

    // Contextual empty copy: distinguish "no search results" from "filter is empty".
    const emptyText = q
        ? t('inbox.emptySearch', { q: search.trim() })
        : (channelFilter !== 'all' || unreadOnly || filter !== 'all')
            ? t('inbox.emptyFilter')
            : t('inbox.empty');

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

            {/* Status filters */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }}>
                {FILTERS.map((f) => (
                    <TouchableOpacity key={f.key} onPress={() => pickFilter(f.key)}
                        accessibilityRole="button" accessibilityState={{ selected: filter === f.key }}
                        accessibilityLabel={t(`inbox.filter.${f.key}`)}
                        style={[styles.filterChip, filter === f.key && styles.filterChipOn]}>
                        <Text style={[styles.filterText, filter === f.key && { color: '#fff' }]}>{t(`inbox.filter.${f.key}`)}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            {/* Channel + unread sub-filters (QW4) — only when there's more than one channel in play */}
            {(channelsPresent.length > 1 || unreadOnly) && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subFilters} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => { haptic.tap(); setUnreadOnly((v) => !v); }}
                        accessibilityRole="button" accessibilityState={{ selected: unreadOnly }}
                        accessibilityLabel={t('inbox.filter.unread')}
                        style={[styles.miniChip, unreadOnly && styles.miniChipOn]}>
                        <Ionicons name="ellipse" size={8} color={unreadOnly ? '#fff' : theme.accent} />
                        <Text style={[styles.miniText, unreadOnly && { color: '#fff' }]}>{t('inbox.filter.unread')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { haptic.tap(); setChannelFilter('all'); }}
                        accessibilityRole="button" accessibilityState={{ selected: channelFilter === 'all' }}
                        style={[styles.miniChip, channelFilter === 'all' && styles.miniChipOn]}>
                        <Text style={[styles.miniText, channelFilter === 'all' && { color: '#fff' }]}>{t('inbox.allChannels')}</Text>
                    </TouchableOpacity>
                    {channelsPresent.map((ch) => (
                        <TouchableOpacity key={ch} onPress={() => { haptic.tap(); setChannelFilter(ch); }}
                            accessibilityRole="button" accessibilityState={{ selected: channelFilter === ch }}
                            accessibilityLabel={channelLabel[ch] || ch}
                            style={[styles.miniChip, channelFilter === ch && { backgroundColor: channelColor[ch] || theme.accent, borderColor: channelColor[ch] || theme.accent }]}>
                            <Ionicons name={(CHANNEL_ICON[ch] || 'chatbox') as any} size={11} color={channelFilter === ch ? '#fff' : (channelColor[ch] || theme.textSecondary)} />
                            <Text style={[styles.miniText, channelFilter === ch && { color: '#fff' }]}>{channelLabel[ch] || ch}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            )}

            {loading ? (
                <ListSkeleton />
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
                    ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>{emptyText}</Text></View>}
                    renderItem={({ item }) => {
                        const ch = item.channel || 'whatsapp';
                        const color = channelColor[ch] || theme.accent;
                        const waiting = item.status === 'waiting_human' || item.status === 'with_human';
                        // SLA-ish wait indicator for handoffs: minutes since last activity.
                        const waitMin = waiting && item.lastMessageAt
                            ? Math.floor((Date.now() - new Date(item.lastMessageAt).getTime()) / 60000) : 0;
                        const slaColor = waitMin >= 15 ? theme.danger : waitMin >= 5 ? theme.warning : theme.success;
                        return (
                            <SwipeableRow onResolve={() => doQuick(item, 'resolve')} onSnooze={() => doQuick(item, 'snooze')}>
                            <TouchableOpacity
                                style={styles.row}
                                accessibilityRole="button"
                                accessibilityLabel={t('inbox.rowA11y', { name: item.contactName || t('inbox.customer'), channel: channelLabel[ch] || ch })}
                                accessibilityHint={t('inbox.rowHint')}
                                onPress={() => { haptic.tap(); nav.navigate('Conversation', { conversationId: item.id, title: item.contactName }); }}
                                onLongPress={() => openQuickActions(item)}
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
                                        <Text style={styles.time}>{relTime(item.lastMessageAt, t('common.justNow'))}</Text>
                                    </View>
                                    <View style={styles.rowBottom}>
                                        <Text style={styles.preview} numberOfLines={1}>{item.lastMessage || '—'}</Text>
                                        {waiting && (
                                            <View style={[styles.handoffBadge, { backgroundColor: slaColor + '22' }]}>
                                                <Ionicons name="time-outline" size={10} color={slaColor} />
                                                <Text style={[styles.handoffText, { color: slaColor }]}>{waitMin > 0 ? relTime(item.lastMessageAt, t('common.justNow')) : t('inbox.filter.handoff')}</Text>
                                            </View>
                                        )}
                                        {!waiting && item.isAiHandled && <Ionicons name="sparkles" size={12} color={theme.accent} style={{ marginLeft: 6 }} />}
                                        {!!item.unreadCount && item.unreadCount > 0 && (
                                            <View style={styles.unread}><Text style={styles.unreadText}>{item.unreadCount}</Text></View>
                                        )}
                                    </View>
                                </View>
                            </TouchableOpacity>
                            </SwipeableRow>
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
    filters: { maxHeight: 52 },
    filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgCard },
    filterChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    filterText: { color: theme.textSecondary, fontSize: 13, fontWeight: '600' },
    subFilters: { maxHeight: 44, marginBottom: 2 },
    miniChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgCard },
    miniChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
    miniText: { color: theme.textSecondary, fontSize: 12, fontWeight: '600' },
    swipeWrap: { position: 'relative', overflow: 'hidden', backgroundColor: theme.bg },
    swipeActions: { position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'stretch' },
    swipeBtn: { width: 70, alignItems: 'center', justifyContent: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.accent + '33', alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: theme.accent, fontWeight: '700', fontSize: 18 },
    chBadge: { position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.bg },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    name: { color: theme.text, fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
    time: { color: theme.textSecondary, fontSize: 12 },
    rowBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
    preview: { color: theme.textSecondary, fontSize: 13, flex: 1 },
    handoffBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.warning + '22', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, marginLeft: 6 },
    handoffText: { color: theme.warning, fontSize: 10, fontWeight: '700' },
    unread: { backgroundColor: theme.accent, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginLeft: 8, paddingHorizontal: 6 },
    unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
