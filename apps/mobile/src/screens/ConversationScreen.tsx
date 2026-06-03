import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
    KeyboardAvoidingView, Platform, Modal, Alert, Image, ScrollView, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { api } from '../lib/api';
import { getInboxSocket, getAgentSocket } from '../lib/socket';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { enqueue, pendingFor, subscribeOutbox } from '../lib/outbox';
import { snoozeUntil, SNOOZE_PRESETS, type SnoozePreset } from '../lib/snooze';
import { theme } from '../theme';
import { SOCKET_URL } from '../lib/config';

interface Msg { id: string; content: string; sender: string; senderName?: string; timestamp?: string; type?: string; metadata?: any; pending?: boolean; failed?: boolean }
interface Note { id: string; content: string; agentName?: string; createdAt?: string }
type TimelineItem = (Msg & { kind: 'msg' }) | (Note & { kind: 'note'; timestamp?: string });

const TONES = ['professional', 'friendly', 'empathetic', 'shorter', 'expand', 'fix_grammar'] as const;

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
    const toast = useToast();
    const { t } = useI18n();
    const { conversationId } = route.params;
    const { tenantId, user } = useAuth();

    const [messages, setMessages] = useState<Msg[]>([]);
    const [outboxTick, setOutboxTick] = useState(0);
    const [snoozeOpen, setSnoozeOpen] = useState(false);
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
    const [viewers, setViewers] = useState<{ agentId: string; agentName: string }[]>([]);
    const [contactOpen, setContactOpen] = useState(false);
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
        const inbox = getInboxSocket();
        const agent = getAgentSocket();
        const agentName = user?.name || user?.email || 'Agente';

        // Live messages arrive tenant-wide on /inbox → filter to this conversation.
        const onNewMessage = (payload: any) => {
            const cid = payload?.conversationId || payload?.conversation_id;
            if (!cid || cid === conversationId) load();
        };
        // Collision detection (other agents viewing) lives on /agent.
        const onViewers = (p: any) => {
            if (p?.conversationId !== conversationId) return;
            setViewers((p.viewers || []).filter((v: any) => v.agentId !== user?.id));
        };

        inbox.on('newMessage', onNewMessage);
        agent.on('conversation:viewers_update', onViewers);
        agent.emit('conversation:open', { conversationId }); // joins the conversation room
        agent.emit('conversation:viewing_start', { conversationId, agentId: user?.id, agentName });
        const hb = setInterval(
            () => agent.emit('conversation:heartbeat', { conversationId, agentId: user?.id, agentName }),
            15000,
        );

        return () => {
            clearInterval(hb);
            agent.emit('conversation:viewing_stop', { conversationId, agentId: user?.id });
            inbox.off('newMessage', onNewMessage);
            agent.off('conversation:viewers_update', onViewers);
        };
    }, [conversationId, load, user?.id]);

    // Re-render + reconcile when the outbox changes (message queued, sent or failed).
    useEffect(() => subscribeOutbox(() => { setOutboxTick((x) => x + 1); load(); }), [load]);

    const timeline = useMemo<TimelineItem[]>(() => {
        const msgs: TimelineItem[] = messages.map((m) => ({ ...m, kind: 'msg' }));
        const nts: TimelineItem[] = notes.map((n) => ({ ...n, kind: 'note', timestamp: n.createdAt }));
        // Pending outbound messages waiting to be sent (offline queue).
        const queued: TimelineItem[] = pendingFor(conversationId).map((q) => ({
            id: q.id, kind: 'msg', sender: 'outbound', content: q.body,
            timestamp: new Date().toISOString(), pending: true, failed: q.failed,
        }));
        return [...msgs, ...nts, ...queued].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
    }, [messages, notes, conversationId, outboxTick]);

    const waiting = conv?.status === 'waiting_human' || conv?.status === 'with_human';
    const resolved = conv?.status === 'resolved' || conv?.status === 'closed';

    const assignToMe = async () => {
        if (!tenantId || !user?.id) return;
        setActing(true);
        try {
            await api.assignConversation(tenantId, conversationId, user.id);
            toast.success(t('conv.assigned'));
            load();
        } catch {
            toast.error(t('conv.assignError'));
        } finally { setActing(false); }
    };
    const returnToAI = () => {
        Alert.alert(t('conv.returnTitle'), t('conv.returnMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('conv.returnConfirm'), onPress: async () => {
                if (!tenantId) return;
                setActing(true);
                try { await api.returnToAI(tenantId, conversationId); toast.success(t('conv.returned')); load(); }
                catch { toast.error(t('conv.returnError')); }
                finally { setActing(false); }
            } },
        ]);
    };
    const resolve = () => {
        Alert.alert(t('conv.resolveTitle'), t('conv.resolveMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('conv.resolveConfirm'), onPress: async () => {
                if (!tenantId) return;
                setActing(true);
                try { await api.resolveConversation(tenantId, conversationId, user?.id); toast.success(t('conv.resolved')); nav.goBack(); }
                catch { toast.error(t('conv.resolveError')); }
                finally { setActing(false); }
            } },
        ]);
    };
    const doReopen = async () => {
        if (!tenantId) return;
        setActing(true);
        try {
            await api.reopenConversation(tenantId, conversationId);
            toast.success(t('conv.reopened'));
            load();
        } catch {
            toast.error(t('conv.reopenError'));
        } finally { setActing(false); }
    };
    const doSnooze = async (preset: SnoozePreset) => {
        setSnoozeOpen(false);
        if (!tenantId) return;
        setActing(true);
        try {
            await api.snoozeConversation(tenantId, conversationId, snoozeUntil(preset).toISOString());
            toast.success(t('conv.snoozed'));
            nav.goBack();
        } catch {
            toast.error(t('conv.snoozeError'));
        } finally { setActing(false); }
    };
    const runMacro = async (macroId: string) => {
        if (!tenantId || !user?.id) return;
        setMacrosOpen(false); setActing(true);
        try { await api.executeMacro(tenantId, macroId, conversationId, user.id); toast.success(t('conv.macroDone')); load(); }
        catch { toast.error(t('conv.macroError')); }
        finally { setActing(false); }
    };
    const saveNote = async () => {
        if (!tenantId || !noteText.trim()) return;
        setActing(true);
        try { await api.addNote(tenantId, conversationId, noteText.trim(), user?.id); setNoteText(''); setNoteOpen(false); toast.success(t('conv.noteSaved')); load(); }
        catch { toast.error(t('conv.noteSaveError')); }
        finally { setActing(false); }
    };
    const doSummary = async () => {
        setSummary('...'); setAiBusy(true);
        try {
            const res: any = await api.copilotSummary(conversationId);
            const d = res?.data;
            setSummary(typeof d === 'string' ? d : (d?.summary || d?.text || 'Sin resumen disponible.'));
        } catch {
            setSummary('');
            toast.error(t('conv.summaryError'));
        } finally { setAiBusy(false); }
    };
    const send = async () => {
        if (!text.trim() || !tenantId || sending) return;
        const body = text.trim(); setText(''); setSending(true);
        const tmpId = `tmp-${Date.now()}`;
        setMessages((prev) => [...prev, { id: tmpId, sender: 'outbound', content: body, timestamp: new Date().toISOString() }]);
        try {
            await api.sendMessage(tenantId, conversationId, body, user?.id);
            load();
        } catch {
            // Don't lose it: hand off to the outbox to auto-retry on reconnect.
            // It renders as a pending bubble (sourced from the queue, not `messages`).
            setMessages((prev) => prev.filter((m) => m.id !== tmpId));
            enqueue({ id: tmpId, tenantId, conversationId, body, agentId: user?.id });
            toast.info(t('conv.queued'));
        } finally { setSending(false); }
    };
    // ✨ context-aware: empty draft → suggest; with draft → rewrite tones.
    const aiButton = async () => {
        if (text.trim()) { setToneOpen(true); return; }
        if (!tenantId) return;
        setAiBusy(true);
        try {
            const res: any = await api.getAiSuggestion(tenantId, conversationId);
            const s = res?.data?.suggestion || res?.data?.suggestions?.[0] || res?.data;
            if (typeof s === 'string' && s.trim()) setText(s);
            else toast.info(t('conv.noSuggestion'));
        } catch {
            toast.error(t('conv.suggestError'));
        } finally { setAiBusy(false); }
    };
    const rewrite = async (tone: string) => {
        setToneOpen(false);
        if (!text.trim()) return;
        setAiBusy(true);
        try {
            const res: any = await api.copilotRewrite(conversationId, text.trim(), tone);
            const d = res?.data;
            const txt = typeof d === 'string' ? d : (d?.rewritten || d?.text || d?.reply || '');
            if (txt) setText(txt);
            else toast.info(t('conv.rewriteNone'));
        } catch {
            toast.error(t('conv.rewriteError'));
        } finally { setAiBusy(false); }
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

            {viewers.length > 0 && (
                <View style={styles.viewersBar}>
                    <Ionicons name="eye-outline" size={14} color={theme.warning} />
                    <Text style={styles.viewersText} numberOfLines={1}>
                        {t(viewers.length > 1 ? 'conv.viewersMany' : 'conv.viewersOne', { names: viewers.map((v) => v.agentName).join(', ') })}
                    </Text>
                </View>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, alignItems: 'center' }}>
                <Action icon="information-circle-outline" label={t('conv.action.contact')} color={theme.textSecondary} onPress={() => setContactOpen(true)} />
                <Action icon="person-add-outline" label={t('conv.action.assign')} color={theme.accent} onPress={assignToMe} disabled={acting} />
                {waiting && <Action icon="sparkles-outline" label={t('conv.action.returnAi')} color={theme.accent} onPress={returnToAI} disabled={acting} />}
                <Action icon="document-text-outline" label={t('conv.action.summarize')} color={theme.textSecondary} onPress={doSummary} disabled={aiBusy} />
                <Action icon="create-outline" label={t('conv.action.note')} color={theme.warning} onPress={() => setNoteOpen(true)} disabled={acting} />
                <Action icon="moon-outline" label={t('conv.action.snooze')} color={theme.textSecondary} onPress={() => setSnoozeOpen(true)} disabled={acting} />
                {!resolved && <Action icon="checkmark-done-outline" label={t('conv.action.resolve')} color={theme.success} onPress={resolve} disabled={acting} />}
                {resolved && <Action icon="refresh-outline" label={t('conv.action.reopen')} color={theme.accent} onPress={doReopen} disabled={acting} />}
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
                                    <Text style={styles.noteLabel}>📝 {t('conv.noteLabel')}{item.agentName ? ` · ${item.agentName}` : ''}</Text>
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
                                {isAudio && <Text style={styles.mediaTag}>🎤 {t('conv.voiceNote')}</Text>}
                                {!!item.content && <Text style={[styles.bubbleText, item.pending && { opacity: 0.7 }]}>{item.content}</Text>}
                                <View style={styles.bubbleMeta}>
                                    {item.pending
                                        ? <Ionicons name={item.failed ? 'alert-circle' : 'time-outline'} size={11} color={item.failed ? theme.danger : 'rgba(255,255,255,0.7)'} />
                                        : <Text style={styles.bubbleTime}>{fmtTime(item.timestamp)}</Text>}
                                </View>
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
                <TextInput style={styles.input} placeholder={t('conv.composer')} placeholderTextColor={theme.textSecondary} value={text} onChangeText={setText} multiline />
                <TouchableOpacity onPress={send} style={styles.sendBtn} disabled={sending || !text.trim()}><Ionicons name="send" size={20} color="#fff" /></TouchableOpacity>
            </View>

            {/* Tone sheet (rewrite) */}
            <Sheet visible={toneOpen} title={t('conv.rewriteTitle')} onClose={() => setToneOpen(false)}>
                <View style={styles.toneGrid}>
                    {TONES.map((tone) => (
                        <TouchableOpacity key={tone} style={styles.toneChip} onPress={() => rewrite(tone)}>
                            <Text style={styles.toneText}>{t(`conv.tone.${tone}`)}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </Sheet>

            {/* Snooze */}
            <Sheet visible={snoozeOpen} title={t('conv.snoozeTitle')} onClose={() => setSnoozeOpen(false)}>
                <View style={styles.toneGrid}>
                    {SNOOZE_PRESETS.map((p) => (
                        <TouchableOpacity key={p.key} style={styles.toneChip} onPress={() => doSnooze(p.key)}>
                            <Text style={styles.toneText}>{t(p.labelKey)}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </Sheet>

            {/* Canned */}
            <Sheet visible={cannedOpen} title={t('conv.cannedSheet')} onClose={() => setCannedOpen(false)}>
                <FlatList data={canned} keyExtractor={(c, i) => c.id || String(i)} renderItem={({ item }) => {
                    const body = item.content || item.body || item.text || '';
                    return (
                        <TouchableOpacity style={styles.cannedRow} onPress={() => { setText(body); setCannedOpen(false); }}>
                            <Text style={styles.cannedTitle}>{item.title || item.shortcut || t('conv.cannedFallback')}</Text>
                            <Text style={styles.cannedBody} numberOfLines={2}>{body}</Text>
                        </TouchableOpacity>
                    );
                }} />
            </Sheet>

            {/* Macros */}
            <Sheet visible={macrosOpen} title={t('conv.macrosSheet')} onClose={() => setMacrosOpen(false)}>
                <FlatList data={macros} keyExtractor={(m, i) => m.id || String(i)} renderItem={({ item }) => (
                    <TouchableOpacity style={styles.cannedRow} onPress={() => runMacro(item.id)}>
                        <Text style={styles.cannedTitle}>{item.name || item.title || t('conv.macroFallback')}</Text>
                        {!!(item.description || item.actions?.length) && <Text style={styles.cannedBody} numberOfLines={1}>{item.description || t('conv.macroActions', { n: item.actions?.length || 0 })}</Text>}
                    </TouchableOpacity>
                )} />
            </Sheet>

            {/* Note */}
            <Sheet visible={noteOpen} title={t('conv.noteSheet')} onClose={() => setNoteOpen(false)}>
                <TextInput style={styles.noteInput} placeholder={t('conv.notePlaceholder')} placeholderTextColor={theme.textSecondary} value={noteText} onChangeText={setNoteText} multiline />
                <TouchableOpacity style={styles.saveBtn} onPress={saveNote} disabled={acting || !noteText.trim()}>
                    <Text style={styles.saveBtnText}>{t('conv.saveNote')}</Text>
                </TouchableOpacity>
            </Sheet>

            {/* Summary */}
            <Sheet visible={summary !== null} title={t('conv.summarySheet')} onClose={() => setSummary(null)}>
                {summary === '...' ? <ActivityIndicator color={theme.accent} /> : <Text style={styles.summaryText}>{summary}</Text>}
            </Sheet>

            {/* Contact 360° */}
            <Sheet visible={contactOpen} title={conv?.contact?.name || t('conv.contactSheet')} onClose={() => setContactOpen(false)}>
                {conv?.contact && (
                    <View>
                        <View style={styles.contactActions}>
                            {!!conv.contact.phone && (
                                <TouchableOpacity style={styles.cAction} onPress={() => Linking.openURL(`tel:${conv.contact.phone}`)}>
                                    <Ionicons name="call-outline" size={18} color={theme.accent} /><Text style={styles.cActionText}>{t('crm.call')}</Text>
                                </TouchableOpacity>
                            )}
                            {!!conv.contact.phone && (
                                <TouchableOpacity style={styles.cAction} onPress={() => Linking.openURL(`https://wa.me/${String(conv.contact.phone).replace(/[^0-9]/g, '')}`)}>
                                    <Ionicons name="logo-whatsapp" size={18} color={theme.success} /><Text style={[styles.cActionText, { color: theme.success }]}>WhatsApp</Text>
                                </TouchableOpacity>
                            )}
                            {!!conv.contact.email && (
                                <TouchableOpacity style={styles.cAction} onPress={() => Linking.openURL(`mailto:${conv.contact.email}`)}>
                                    <Ionicons name="mail-outline" size={18} color={theme.accent} /><Text style={styles.cActionText}>{t('crm.email')}</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                        <CRow label={t('crm.field.phone')} value={conv.contact.phone} />
                        <CRow label={t('crm.email')} value={conv.contact.email} />
                        <CRow label={t('conv.segment')} value={conv.contact.segment} />
                        <CRow label={t('conv.ltv')} value={conv.contact.lifetimeValue ? `$${Number(conv.contact.lifetimeValue).toLocaleString()}` : undefined} />
                        <CRow label={t('conv.conversations')} value={conv.contact.conversationCount != null ? String(conv.contact.conversationCount) : undefined} />
                        {Array.isArray(conv.contact.tags) && conv.contact.tags.length > 0 && (
                            <View style={{ marginTop: 8 }}>
                                <Text style={styles.cLabel}>{t('crm.section.tags')}</Text>
                                <View style={styles.tagWrap}>
                                    {conv.contact.tags.map((t: any, i: number) => (
                                        <View key={i} style={styles.tag}><Text style={styles.tagText}>{typeof t === 'string' ? t : t.name}</Text></View>
                                    ))}
                                </View>
                            </View>
                        )}
                    </View>
                )}
            </Sheet>
        </KeyboardAvoidingView>
    );
}

function CRow({ label, value }: { label: string; value?: string }) {
    if (!value) return null;
    return (
        <View style={styles.cRow}>
            <Text style={styles.cLabel}>{label}</Text>
            <Text style={styles.cValue}>{value}</Text>
        </View>
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
    bubbleMeta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 2 },
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
    viewersBar: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.warning + '14', paddingHorizontal: 14, paddingVertical: 6 },
    viewersText: { color: theme.warning, fontSize: 12, flex: 1 },
    contactActions: { flexDirection: 'row', gap: 10, marginBottom: 14 },
    cAction: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: theme.bg, borderColor: theme.border, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
    cActionText: { color: theme.accent, fontWeight: '600', fontSize: 13 },
    cRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    cLabel: { color: theme.textSecondary, fontSize: 14 },
    cValue: { color: theme.text, fontSize: 14, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
    tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
    tag: { backgroundColor: theme.accent + '22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    tagText: { color: theme.accent, fontSize: 12, fontWeight: '600' },
});
