import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
    KeyboardAvoidingView, Platform, Modal, Alert, Image, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { api } from '../lib/api';
import { connectSocket } from '../lib/socket';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';
import { SOCKET_URL } from '../lib/config';

interface Msg { id: string; content: string; sender: string; senderName?: string; timestamp?: string; type?: string; metadata?: any }
interface Note { id: string; content: string; agentName?: string; createdAt?: string }
type TimelineItem = (Msg & { kind: 'msg' }) | (Note & { kind: 'note'; timestamp?: string });

const TONES = [
    { key: 'professional', label: 'Profesional' },
    { key: 'friendly', label: 'Amigable' },
    { key: 'empathetic', label: 'Empático' },
    { key: 'shorter', label: 'Más corto' },
    { key: 'expand', label: 'Ampliar' },
    { key: 'fix_grammar', label: 'Corregir' },
];

function fmtTime(iso?: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function mediaUrl(m: any): string | null {
    const u = m?.mediaUrl || m?.url || m?.imageUrl || m?.image || m?.media?.url || m?.media_url;
    if (!u || typeof u !== 'string') return null;
    return u.startsWith('http') ? u : `${SOCKET_URL}${u.startsWith('/') ? '' : '/'}${u}`;
}

export function ConversationScreen() {
    const route = useRoute<any>();
    const nav = useNavigation<any>();
    const { conversationId } = route.params;
    const { tenantId, user } = useAuth();

    const [messages, setMessages] = useState<Msg[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [conv, setConv] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const [aiBusy, setAiBusy] = useState(false);
    const [canned, setCanned] = useState<any[]>([]);
    const [cannedOpen, setCannedOpen] = useState(false);
    const [macros, setMacros] = useState<any[]>([]);
    const [macrosOpen, setMacrosOpen] = useState(false);
    const [toneOpen, setToneOpen] = useState(false);
    const [noteOpen, setNoteOpen] = useState(false);
    const [noteText, setNoteText] = useState('');
    const [summary, setSummary] = useState<string | null>(null);
    const [acting, setActing] = useState(false);
    const listRef = useRef<FlatList>(null);

    const load = useCallback(async () => {
        if (!tenantId) return;
        const res: any = await api.getConversation(tenantId, conversationId);
        if (res?.success && res.data) {
            setConv(res.data);
            setMessages(Array.isArray(res.data.messages) ? res.data.messages : []);
            setNotes(Array.isArray(res.data.notes) ? res.data.notes : []);
        }
        setLoading(false);
    }, [tenantId, conversationId]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (!tenantId) return;
        api.getCannedResponses(tenantId).then((r: any) => { if (r?.success && Array.isArray(r.data)) setCanned(r.data); });
        api.getMacros(tenantId).then((r: any) => { if (r?.success && Array.isArray(r.data)) setMacros(r.data); });
    }, [tenantId]);

    useEffect(() => {
        let active = true;
        (async () => {
            const socket = await connectSocket();
            socket.on('newMessage', (payload: any) => {
                if (!active) return;
                const cid = payload?.conversationId || payload?.conversation_id;
                if (!cid || cid === conversationId) load();
            });
        })();
        return () => { active = false; };
    }, [conversationId, load]);

    const timeline = useMemo<TimelineItem[]>(() => {
        const msgs: TimelineItem[] = messages.map((m) => ({ ...m, kind: 'msg' }));
        const nts: TimelineItem[] = notes.map((n) => ({ ...n, kind: 'note', timestamp: n.createdAt }));
        return [...msgs, ...nts].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
    }, [messages, notes]);

    const waiting = conv?.status === 'waiting_human' || conv?.status === 'with_human';

    const assignToMe = async () => {
        if (!tenantId || !user?.id) return;
        setActing(true); await api.assignConversation(tenantId, conversationId, user.id); setActing(false);
        Alert.alert('Asignada', 'La conversación te fue asignada.'); load();
    };
    const returnToAI = () => {
        Alert.alert('Devolver a la IA', 'La IA volverá a responder esta conversación.', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Devolver', onPress: async () => { if (!tenantId) return; setActing(true); await api.returnToAI(tenantId, conversationId); setActing(false); load(); } },
        ]);
    };
    const resolve = () => {
        Alert.alert('Resolver', '¿Marcar como resuelta?', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Resolver', onPress: async () => { if (!tenantId) return; setActing(true); await api.resolveConversation(tenantId, conversationId, user?.id); setActing(false); nav.goBack(); } },
        ]);
    };
    const runMacro = async (macroId: string) => {
        if (!tenantId || !user?.id) return;
        setMacrosOpen(false); setActing(true);
        await api.executeMacro(tenantId, macroId, conversationId, user.id);
        setActing(false); load();
    };
    const saveNote = async () => {
        if (!tenantId || !noteText.trim()) return;
        setActing(true);
        await api.addNote(tenantId, conversationId, noteText.trim(), user?.id);
        setNoteText(''); setNoteOpen(false); setActing(false); load();
    };
    const doSummary = async () => {
        setSummary('...'); setAiBusy(true);
        const res: any = await api.copilotSummary(conversationId);
        const d = res?.data;
        setSummary(typeof d === 'string' ? d : (d?.summary || d?.text || 'Sin resumen disponible.'));
        setAiBusy(false);
    };
    const send = async () => {
        if (!text.trim() || !tenantId || sending) return;
        const body = text.trim(); setText(''); setSending(true);
        setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, sender: 'outbound', content: body, timestamp: new Date().toISOString() }]);
        await api.sendMessage(tenantId, conversationId, body, user?.id);
        setSending(false); load();
    };
    // ✨ context-aware: empty draft → suggest; with draft → rewrite tones.
    const aiButton = async () => {
        if (text.trim()) { setToneOpen(true); return; }
        if (!tenantId) return;
        setAiBusy(true);
        const res: any = await api.getAiSuggestion(tenantId, conversationId);
        const s = res?.data?.suggestion || res?.data?.suggestions?.[0] || res?.data;
        if (typeof s === 'string') setText(s);
        setAiBusy(false);
    };
    const rewrite = async (tone: string) => {
        setToneOpen(false);
        if (!text.trim()) return;
        setAiBusy(true);
        const res: any = await api.copilotRewrite(conversationId, text.trim(), tone);
        const d = res?.data;
        const txt = typeof d === 'string' ? d : (d?.rewritten || d?.text || d?.reply || '');
        if (txt) setText(txt);
        setAiBusy(false);
    };

    if (loading) return <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>;

    return (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            {waiting && conv?.handoffReason && (
                <View style={styles.handoffBanner}>
                    <Ionicons name="alert-circle-outline" size={15} color={theme.warning} />
                    <Text style={styles.handoffText} numberOfLines={2}>{conv.handoffSummary || conv.handoffReason}</Text>
                </View>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, alignItems: 'center' }}>
                <Action icon="person-add-outline" label="Asignarme" color={theme.accent} onPress={assignToMe} disabled={acting} />
                {waiting && <Action icon="sparkles-outline" label="Devolver IA" color={theme.accent} onPress={returnToAI} disabled={acting} />}
                <Action icon="document-text-outline" label="Resumir" color={theme.textSecondary} onPress={doSummary} disabled={aiBusy} />
                <Action icon="create-outline" label="Nota" color={theme.warning} onPress={() => setNoteOpen(true)} disabled={acting} />
                <Action icon="checkmark-done-outline" label="Resolver" color={theme.success} onPress={resolve} disabled={acting} />
                {(acting || aiBusy) && <ActivityIndicator color={theme.accent} size="small" />}
            </ScrollView>

            <FlatList
                ref={listRef}
                data={timeline}
                keyExtractor={(it, i) => it.id || String(i)}
                contentContainerStyle={{ padding: 12 }}
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                renderItem={({ item }) => {
                    if (item.kind === 'note') {
                        return (
                            <View style={styles.noteWrap}>
                                <View style={styles.note}>
                                    <Text style={styles.noteLabel}>📝 Nota{item.agentName ? ` · ${item.agentName}` : ''}</Text>
                                    <Text style={styles.noteText}>{item.content}</Text>
                                </View>
                            </View>
                        );
                    }
                    const out = item.sender === 'outbound';
                    const img = item.type === 'image' ? mediaUrl(item.metadata) : null;
                    const isAudio = item.type === 'audio' || item.type === 'voice';
                    return (
                        <View style={[styles.bubbleRow, { justifyContent: out ? 'flex-end' : 'flex-start' }]}>
                            <View style={[styles.bubble, out ? styles.bubbleOut : styles.bubbleIn]}>
                                {img && <Image source={{ uri: img }} style={styles.media} resizeMode="cover" />}
                                {isAudio && <Text style={styles.mediaTag}>🎤 Nota de voz</Text>}
                                {!!item.content && <Text style={styles.bubbleText}>{item.content}</Text>}
                                <Text style={styles.bubbleTime}>{fmtTime(item.timestamp)}</Text>
                            </View>
                        </View>
                    );
                }}
            />

            <View style={styles.composer}>
                {canned.length > 0 && (
                    <TouchableOpacity onPress={() => setCannedOpen(true)} style={styles.iconBtn}><Ionicons name="albums-outline" size={22} color={theme.textSecondary} /></TouchableOpacity>
                )}
                {macros.length > 0 && (
                    <TouchableOpacity onPress={() => setMacrosOpen(true)} style={styles.iconBtn} disabled={acting}><Ionicons name="flash-outline" size={22} color={theme.warning} /></TouchableOpacity>
                )}
                <TouchableOpacity onPress={aiButton} style={styles.iconBtn} disabled={aiBusy}>
                    {aiBusy ? <ActivityIndicator color={theme.accent} size="small" /> : <Ionicons name="sparkles-outline" size={22} color={theme.accent} />}
                </TouchableOpacity>
                <TextInput style={styles.input} placeholder="Escribe un mensaje…" placeholderTextColor={theme.textSecondary} value={text} onChangeText={setText} multiline />
                <TouchableOpacity onPress={send} style={styles.sendBtn} disabled={sending || !text.trim()}><Ionicons name="send" size={20} color="#fff" /></TouchableOpacity>
            </View>

            {/* Tone sheet (rewrite) */}
            <Sheet visible={toneOpen} title="Reescribir con IA" onClose={() => setToneOpen(false)}>
                <View style={styles.toneGrid}>
                    {TONES.map((t) => (
                        <TouchableOpacity key={t.key} style={styles.toneChip} onPress={() => rewrite(t.key)}>
                            <Text style={styles.toneText}>{t.label}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </Sheet>

            {/* Canned */}
            <Sheet visible={cannedOpen} title="Respuestas rápidas" onClose={() => setCannedOpen(false)}>
                <FlatList data={canned} keyExtractor={(c, i) => c.id || String(i)} renderItem={({ item }) => {
                    const body = item.content || item.body || item.text || '';
                    return (
                        <TouchableOpacity style={styles.cannedRow} onPress={() => { setText(body); setCannedOpen(false); }}>
                            <Text style={styles.cannedTitle}>{item.title || item.shortcut || 'Respuesta'}</Text>
                            <Text style={styles.cannedBody} numberOfLines={2}>{body}</Text>
                        </TouchableOpacity>
                    );
                }} />
            </Sheet>

            {/* Macros */}
            <Sheet visible={macrosOpen} title="Macros" onClose={() => setMacrosOpen(false)}>
                <FlatList data={macros} keyExtractor={(m, i) => m.id || String(i)} renderItem={({ item }) => (
                    <TouchableOpacity style={styles.cannedRow} onPress={() => runMacro(item.id)}>
                        <Text style={styles.cannedTitle}>{item.name || item.title || 'Macro'}</Text>
                        {!!(item.description || item.actions?.length) && <Text style={styles.cannedBody} numberOfLines={1}>{item.description || `${item.actions?.length || 0} acciones`}</Text>}
                    </TouchableOpacity>
                )} />
            </Sheet>

            {/* Note */}
            <Sheet visible={noteOpen} title="Nota interna" onClose={() => setNoteOpen(false)}>
                <TextInput style={styles.noteInput} placeholder="Escribe una nota (solo para el equipo)…" placeholderTextColor={theme.textSecondary} value={noteText} onChangeText={setNoteText} multiline />
                <TouchableOpacity style={styles.saveBtn} onPress={saveNote} disabled={acting || !noteText.trim()}>
                    <Text style={styles.saveBtnText}>Guardar nota</Text>
                </TouchableOpacity>
            </Sheet>

            {/* Summary */}
            <Sheet visible={summary !== null} title="Resumen del hilo" onClose={() => setSummary(null)}>
                {summary === '...' ? <ActivityIndicator color={theme.accent} /> : <Text style={styles.summaryText}>{summary}</Text>}
            </Sheet>
        </KeyboardAvoidingView>
    );
}

function Action({ icon, label, color, onPress, disabled }: { icon: any; label: string; color: string; onPress: () => void; disabled?: boolean }) {
    return (
        <TouchableOpacity style={styles.actionBtn} onPress={onPress} disabled={disabled}>
            <Ionicons name={icon} size={16} color={color} />
            <Text style={[styles.actionBtnText, { color }]}>{label}</Text>
        </TouchableOpacity>
    );
}
function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose}>
                <View style={styles.sheet} onStartShouldSetResponder={() => true}>
                    <Text style={styles.sheetTitle}>{title}</Text>
                    {children}
                </View>
            </TouchableOpacity>
        </Modal>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
    handoffBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.warning + '18', paddingHorizontal: 14, paddingVertical: 10 },
    handoffText: { color: theme.warning, fontSize: 13, flex: 1 },
    actionBar: { maxHeight: 52, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: theme.bgCard },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderColor: theme.border, borderWidth: 1 },
    actionBtnText: { fontSize: 13, fontWeight: '600' },
    bubbleRow: { flexDirection: 'row', marginVertical: 3 },
    bubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 5 },
    bubbleIn: { backgroundColor: theme.bubbleIn, borderBottomLeftRadius: 4 },
    bubbleOut: { backgroundColor: theme.bubbleOut, borderBottomRightRadius: 4 },
    bubbleText: { color: theme.text, fontSize: 15 },
    bubbleTime: { color: theme.textSecondary, fontSize: 10, alignSelf: 'flex-end', marginTop: 2, opacity: 0.8 },
    media: { width: 200, height: 200, borderRadius: 10, marginBottom: 4 },
    mediaTag: { color: theme.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
    noteWrap: { alignItems: 'center', marginVertical: 6 },
    note: { backgroundColor: theme.warning + '14', borderColor: theme.warning + '40', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '88%' },
    noteLabel: { color: theme.warning, fontSize: 11, fontWeight: '700', marginBottom: 2 },
    noteText: { color: theme.text, fontSize: 13 },
    composer: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, gap: 4, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth, backgroundColor: theme.bgCard },
    iconBtn: { padding: 8 },
    input: { flex: 1, backgroundColor: theme.bg, borderColor: theme.border, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, color: theme.text, fontSize: 15, maxHeight: 120 },
    sendBtn: { backgroundColor: theme.accent, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.bgCard, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: '60%' },
    sheetTitle: { color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
    cannedRow: { paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    cannedTitle: { color: theme.text, fontSize: 14, fontWeight: '600' },
    cannedBody: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
    toneGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    toneChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg },
    toneText: { color: theme.text, fontSize: 14, fontWeight: '600' },
    noteInput: { backgroundColor: theme.bg, borderColor: theme.border, borderWidth: 1, borderRadius: 10, padding: 12, color: theme.text, fontSize: 15, minHeight: 90, textAlignVertical: 'top' },
    saveBtn: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
    saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
    summaryText: { color: theme.text, fontSize: 15, lineHeight: 22 },
});
