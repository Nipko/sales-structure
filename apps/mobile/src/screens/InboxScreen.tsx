import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '../lib/api';
import { connectSocket } from '../lib/socket';
import { useAuth } from '../contexts/AuthContext';
import { theme, channelColor } from '../theme';
import type { InboxStackParams } from '../navigation/RootNavigator';

interface Conv {
    id: string;
    contactName?: string;
    name?: string;
    lastMessage?: string;
    last_message?: string;
    channelType?: string;
    channel_type?: string;
    status?: string;
    unreadCount?: number;
}

function field(c: Conv, ...keys: (keyof Conv)[]): any {
    for (const k of keys) if (c[k] != null) return c[k];
    return undefined;
}

export function InboxScreen() {
    const { tenantId, user } = useAuth();
    const nav = useNavigation<NativeStackNavigationProp<InboxStackParams>>();
    const [items, setItems] = useState<Conv[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        if (!tenantId) return;
        const res: any = await api.getInbox(tenantId);
        if (res?.success) {
            const data = Array.isArray(res.data) ? res.data : (res.data?.conversations || []);
            setItems(data);
        }
        setLoading(false);
        setRefreshing(false);
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    // Real-time refresh
    useEffect(() => {
        let active = true;
        (async () => {
            const socket = await connectSocket();
            const reload = () => { if (active) load(); };
            socket.on('newMessage', reload);
            socket.on('inbox:refresh', reload);
            socket.on('inbox:handoff', reload);
        })();
        return () => { active = false; };
    }, [load]);

    if (loading) {
        return <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>;
    }

    return (
        <FlatList
            style={{ backgroundColor: theme.bg }}
            data={items}
            keyExtractor={(c) => c.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
            ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>No hay conversaciones.</Text></View>}
            renderItem={({ item }) => {
                const name = field(item, 'contactName', 'name') || 'Cliente';
                const last = field(item, 'lastMessage', 'last_message') || '';
                const ch = (field(item, 'channelType', 'channel_type') || 'whatsapp') as string;
                return (
                    <TouchableOpacity
                        style={styles.row}
                        onPress={() => nav.navigate('Conversation', { conversationId: item.id, title: String(name) })}
                    >
                        <View style={[styles.dot, { backgroundColor: channelColor[ch] || theme.accent }]} />
                        <View style={{ flex: 1 }}>
                            <View style={styles.rowTop}>
                                <Text style={styles.name} numberOfLines={1}>{name}</Text>
                                {item.status === 'waiting_human' && <Text style={styles.badge}>Espera</Text>}
                            </View>
                            <Text style={styles.preview} numberOfLines={1}>{last || '—'}</Text>
                        </View>
                        {!!item.unreadCount && item.unreadCount > 0 && (
                            <View style={styles.unread}><Text style={styles.unreadText}>{item.unreadCount}</Text></View>
                        )}
                    </TouchableOpacity>
                );
            }}
        />
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, backgroundColor: theme.bg },
    empty: { color: theme.textSecondary, fontSize: 14 },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    name: { color: theme.text, fontSize: 15, fontWeight: '600', flex: 1 },
    badge: { color: theme.warning, fontSize: 11, fontWeight: '600', marginLeft: 8 },
    preview: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
    unread: { backgroundColor: theme.accent, borderRadius: 11, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 10, paddingHorizontal: 6 },
    unreadText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
