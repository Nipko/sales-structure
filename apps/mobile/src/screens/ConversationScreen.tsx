import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
    KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { api } from '../lib/api';
import { connectSocket } from '../lib/socket';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

interface Msg {
    id?: string;
    direction?: string;
    content_text?: string;
    text?: string;
    content?: any;
    created_at?: string;
}

function msgText(m: Msg): string {
    return m.content_text || m.text || (typeof m.content === 'string' ? m.content : m.content?.text) || '';
}

export function ConversationScreen() {
    const route = useRoute<any>();
    const { conversationId } = route.params;
    const { tenantId, user } = useAuth();
    const [messages, setMessages] = useState<Msg[]>([]);
    const [loading, setLoading] = useState(true);
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const [suggesting, setSuggesting] = useState(false);
    const listRef = useRef<FlatList>(null);

    const load = useCallback(async () => {
        if (!tenantId) return;
        const res: any = await api.getConversation(tenantId, conversationId);
        if (res?.success) {
            const msgs = res.data?.messages || res.data?.conversation?.messages || [];
            setMessages(Array.isArray(msgs) ? msgs : []);
        }
        setLoading(false);
    }, [tenantId, conversationId]);

    useEffect(() => { load(); }, [load]);

    // Append real-time inbound/outbound messages for this conversation.
    useEffect(() => {
        let active = true;
        (async () => {
            const socket = await connectSocket();
            socket.on('newMessage', (payload: any) => {
                if (!active) return;
                const cid = payload?.conversationId || payload?.conversation_id;
                if (cid && cid !== conversationId) return;
                const m = payload?.message || payload;
                setMessages((prev) => [...prev, m]);
            });
        })();
        return () => { active = false; };
    }, [conversationId]);

    const send = async () => {
        if (!text.trim() || !tenantId || sending) return;
        const body = text.trim();
        setText('');
        setSending(true);
        // optimistic
        setMessages((prev) => [...prev, { direction: 'outbound', content_text: body, id: `tmp-${Date.now()}` }]);
        await api.sendMessage(tenantId, conversationId, body, user?.id);
        setSending(false);
    };

    const suggest = async () => {
        if (!tenantId || suggesting) return;
        setSuggesting(true);
        const res: any = await api.getAiSuggestion(tenantId, conversationId);
        const s = res?.data?.suggestion || res?.data?.suggestions?.[0] || res?.data;
        if (typeof s === 'string') setText(s);
        setSuggesting(false);
    };

    if (loading) {
        return <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>;
    }

    return (
        <KeyboardAvoidingView
            style={{ flex: 1, backgroundColor: theme.bg }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={90}
        >
            <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={(m, i) => m.id || String(i)}
                contentContainerStyle={{ padding: 12 }}
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                renderItem={({ item }) => {
                    const out = item.direction === 'outbound';
                    return (
                        <View style={[styles.bubbleRow, { justifyContent: out ? 'flex-end' : 'flex-start' }]}>
                            <View style={[styles.bubble, { backgroundColor: out ? theme.bubbleOut : theme.bubbleIn }]}>
                                <Text style={styles.bubbleText}>{msgText(item)}</Text>
                            </View>
                        </View>
                    );
                }}
            />

            <View style={styles.composer}>
                <TouchableOpacity onPress={suggest} style={styles.iconBtn} disabled={suggesting}>
                    {suggesting ? <ActivityIndicator color={theme.accent} size="small" /> : <Ionicons name="sparkles-outline" size={22} color={theme.accent} />}
                </TouchableOpacity>
                <TextInput
                    style={styles.input}
                    placeholder="Escribe un mensaje…"
                    placeholderTextColor={theme.textSecondary}
                    value={text}
                    onChangeText={setText}
                    multiline
                />
                <TouchableOpacity onPress={send} style={styles.sendBtn} disabled={sending || !text.trim()}>
                    <Ionicons name="send" size={20} color="#fff" />
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
    bubbleRow: { flexDirection: 'row', marginVertical: 3 },
    bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
    bubbleText: { color: theme.text, fontSize: 15 },
    composer: {
        flexDirection: 'row', alignItems: 'flex-end', padding: 8, gap: 6,
        borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth, backgroundColor: theme.bgCard,
    },
    iconBtn: { padding: 8 },
    input: {
        flex: 1, backgroundColor: theme.bg, borderColor: theme.border, borderWidth: 1, borderRadius: 20,
        paddingHorizontal: 14, paddingVertical: 8, color: theme.text, fontSize: 15, maxHeight: 120,
    },
    sendBtn: { backgroundColor: theme.accent, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
