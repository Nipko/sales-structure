import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
    KeyboardAvoidingView, Modal, Alert, Image, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '../lib/api';
import { getInboxSocket, getAgentSocket } from '../lib/socket';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { useKeyboardSpace } from '../lib/useKeyboardSpace';
import { enqueue, pendingFor, subscribeOutbox, retry as retryOutbox } from '../lib/outbox';
import { useAudioRecorder, fmtDuration } from '../lib/useAudioRecorder';
import { snoozeUntil, SNOOZE_PRESETS, type SnoozePreset } from '../lib/snooze';
import { haptic } from '../lib/haptics';
import { theme, channelColor, channelLabel, channelIcon } from '../theme';
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
// Infer a document MIME from its filename when the picker doesn't provide one
// (avoids defaulting to image/jpeg, which the upload would reject/mishandle).
const DOC_MIME: Record<string, string> = {
    '.pdf': 'application/pdf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip',
};
function guessMime(name?: string): string {
    const n = name || '';
    const ext = n.slice(n.lastIndexOf('.')).toLowerCase();
    return DOC_MIME[ext] || 'application/octet-stream';
}
const agentIdOf = (a: any): string => a?.userId || a?.user_id || a?.id || a?.agentId || '';
const agentNameOf = (a: any): string => a?.name || a?.agentName || a?.email || agentIdOf(a);
const statusColor = (s?: string): string => s === 'online' ? theme.success : s === 'away' ? theme.warning : theme.textSecondary;

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
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    // Reply / quote
    const [replyTo, setReplyTo] = useState<Msg | null>(null);
    // Inline translations: msgId → translated text
    const [translations, setTranslations] = useState<Record<string, string>>({});
    const [translating, setTranslating] = useState<string | null>(null); // msgId being translated
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
    const [agentsOpen, setAgentsOpen] = useState(false);
    const [agents, setAgents] = useState<any[]>([]);
    const kbSpace = useKeyboardSpace();
    const listRef = useRef<FlatList>(null);
    const { state: recState, durationMs: recMs, startRecording, stopRecording, cancelRecording } = useAudioRecorder();

    const load = useCallback(async () => {
        if (!tenantId) return;
        const res: any = await api.getConversation(tenantId, conversationId, { limit: 50 });
        if (res?.success && res.data) {
            setConv(res.data);
            setMessages(Array.isArray(res.data.messages) ? res.data.messages : []);
            setNotes(Array.isArray(res.data.notes) ? res.data.notes : []);
            setHasMore(!!res.data.hasMore);
        }
        setLoading(false);
    }, [tenantId, conversationId]);

    // Load older messages (cursor = timestamp of oldest message already loaded).
    const loadMore = useCallback(async () => {
        if (!tenantId || loadingMore || !hasMore || messages.length === 0) return;
        setLoadingMore(true);
        const oldest = messages[0]?.timestamp;
        const res: any = await api.getConversation(tenantId, conversationId, { limit: 50, before: oldest });
        if (res?.success && res.data?.messages) {
            setMessages((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                const fresh = (res.data.messages as Msg[]).filter((m) => !existingIds.has(m.id));
                return [...fresh, ...prev];
            });
            setHasMore(!!res.data.hasMore);
        }
        setLoadingMore(false);
    }, [tenantId, conversationId, loadingMore, hasMore, messages]);

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

    // Inverted list (newest first) → the conversation always opens at the latest
    // message, the chat standard. No fragile scrollToEnd needed.
    const reversedTimeline = useMemo(() => [...timeline].reverse(), [timeline]);

    const waiting = conv?.status === 'waiting_human' || conv?.status === 'with_human';
    const resolved = conv?.status === 'resolved' || conv?.status === 'closed';
    const channel: string | undefined = conv?.channel || conv?.channelType || conv?.contact?.channel;
    const assignedToMe = !!(conv?.assignedAgentId && user?.id && conv.assignedAgentId === user.id);
    // Who is responding right now — surfaced as a persistent banner so the agent
    // never wonders whether the bot is still in control (job #2: takeover ambiguity).
    const mode: 'you' | 'ai' | 'waiting' | 'resolved' =
        resolved ? 'resolved' : assignedToMe ? 'you' : waiting ? 'waiting' : 'ai';
    const AUTHOR = {
        you: { icon: 'person-circle', color: theme.success, key: 'conv.author.you' },
        ai: { icon: 'sparkles', color: theme.accent, key: 'conv.author.ai' },
        waiting: { icon: 'alert-circle', color: theme.warning, key: 'conv.author.waiting' },
        resolved: { icon: 'checkmark-done', color: theme.textSecondary, key: 'conv.author.resolved' },
    } as const;

    // Optimistic patch helper: apply local state instantly, reconcile/rollback after.
    const patchConv = (patch: any) => setConv((c: any) => (c ? { ...c, ...patch } : c));
    const undo = (label: string, fn: () => Promise<any>): { label: string; onPress: () => void } =>
        ({ label, onPress: () => { fn().catch(() => toast.error(t('common.undoError'))); } });

    const assignToMe = async () => {
        if (!tenantId || !user?.id) return;
        const prev = conv;
        patchConv({ assignedAgentId: user.id, status: 'with_human' }); // optimista
        setActing(true);
        try {
            await api.assignConversation(tenantId, conversationId, user.id);
            toast.success(t('conv.assigned'));
            load();
        } catch {
            setConv(prev); // rollback
            toast.error(t('conv.assignError'));
        } finally { setActing(false); }
    };
    const returnToAI = () => {
        Alert.alert(t('conv.returnTitle'), t('conv.returnMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('conv.returnConfirm'), onPress: async () => {
                if (!tenantId) return;
                const prev = conv;
                patchConv({ assignedAgentId: null, status: 'active', isAiHandled: true }); // optimista
                setActing(true);
                try { await api.returnToAI(tenantId, conversationId); toast.success(t('conv.returned')); load(); }
                catch { setConv(prev); toast.error(t('conv.returnError')); }
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
                try {
                    await api.resolveConversation(tenantId, conversationId, user?.id);
                    // Undo → reopen. Toast is app-global so it survives goBack().
                    toast.success(t('conv.resolved'), undo(t('common.undo'), () =>
                        api.reopenConversation(tenantId, conversationId).then(() => toast.info(t('conv.reopened')))));
                    nav.goBack();
                }
                catch { toast.error(t('conv.resolveError')); }
                finally { setActing(false); }
            } },
        ]);
    };
    const doReopen = async () => {
        if (!tenantId) return;
        const prev = conv;
        patchConv({ status: 'active' }); // optimista
        setActing(true);
        try {
            await api.reopenConversation(tenantId, conversationId);
            toast.success(t('conv.reopened'));
            load();
        } catch {
            setConv(prev); // rollback
            toast.error(t('conv.reopenError'));
        } finally { setActing(false); }
    };
    const doSnooze = async (preset: SnoozePreset) => {
        setSnoozeOpen(false);
        if (!tenantId) return;
        setActing(true);
        try {
            await api.snoozeConversation(tenantId, conversationId, snoozeUntil(preset).toISOString());
            toast.success(t('conv.snoozed'), undo(t('common.undo'), () =>
                api.unsnoozeConversation(tenantId, conversationId).then(() => toast.info(t('conv.unsnoozed')))));
            nav.goBack();
        } catch {
            toast.error(t('conv.snoozeError'));
        } finally { setActing(false); }
    };
    const openReassign = async () => {
        if (!tenantId) return;
        setAgentsOpen(true);
        try {
            const r: any = await api.getAgentsStatus(tenantId);
            if (r?.success && Array.isArray(r.data)) setAgents(r.data);
        } catch { /* sheet shows empty state */ }
    };
    const reassignTo = async (agentId: string) => {
        setAgentsOpen(false);
        if (!tenantId || !agentId) return;
        const prev = conv;
        patchConv({ assignedAgentId: agentId, status: 'with_human' }); // optimista
        setActing(true);
        try { await api.assignConversation(tenantId, conversationId, agentId); toast.success(t('conv.reassigned')); load(); }
        catch { setConv(prev); toast.error(t('conv.reassignError')); }
        finally { setActing(false); }
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
            setSummary(typeof d === 'string' ? d : (d?.summary || d?.text || t('conv.summaryUnavailable')));
        } catch {
            setSummary('');
            toast.error(t('conv.summaryError'));
        } finally { setAiBusy(false); }
    };
    // ── Long-press context actions ────────────────────────────────────────────
    const translateMsg = async (msg: Msg) => {
        if (!tenantId || translations[msg.id] || translating) return;
        setTranslating(msg.id);
        try {
            const res: any = await api.translateText(tenantId, msg.content);
            if (res?.success && res.data?.translation) {
                setTranslations((prev) => ({ ...prev, [msg.id]: res.data.translation }));
            } else {
                toast.error(t('conv.translateError'));
            }
        } catch {
            toast.error(t('conv.translateError'));
        } finally {
            setTranslating(null);
        }
    };

    const onMsgLongPress = (msg: Msg) => {
        haptic.tap();
        const opts: { text: string; onPress: () => void }[] = [
            { text: t('conv.reply'), onPress: () => setReplyTo(msg) },
        ];
        // Translation only for inbound messages (customer text, not audio/image)
        if (msg.sender !== 'outbound' && msg.content && msg.type !== 'image' && msg.type !== 'audio' && msg.type !== 'voice') {
            opts.push({ text: t('conv.translate'), onPress: () => translateMsg(msg) });
        }
        opts.push({ text: t('common.cancel'), onPress: () => {} });
        Alert.alert('', '', opts.map((o) => ({ text: o.text, onPress: o.onPress })));
    };

    const send = async () => {
        if (!text.trim() || !tenantId || sending) return;
        // Prepend quote if replying
        const body = replyTo
            ? `↩ "${replyTo.content.slice(0, 60)}${replyTo.content.length > 60 ? '…' : ''}"\n\n${text.trim()}`
            : text.trim();
        setReplyTo(null);
        setText(''); setSending(true);
        const tmpId = `tmp-${Date.now()}`;
        setMessages((prev) => [...prev, { id: tmpId, sender: 'outbound', content: body, timestamp: new Date().toISOString() }]);
        try {
            await api.sendMessage(tenantId, conversationId, body, user?.id);
            haptic.success();
            load();
        } catch {
            // Don't lose it: hand off to the outbox to auto-retry on reconnect.
            // It renders as a pending bubble (sourced from the queue, not `messages`).
            setMessages((prev) => prev.filter((m) => m.id !== tmpId));
            enqueue({ id: tmpId, tenantId, conversationId, body, agentId: user?.id });
            haptic.warning();
            toast.info(t('conv.queued'));
        } finally { setSending(false); }
    };
    // ── Audio recording ───────────────────────────────────────────────────────
    const handleMicPress = async () => {
        if (!tenantId) return;
        if (recState === 'recording') {
            // Stop → upload → send
            const result = await stopRecording();
            if (!result) return;
            haptic.success();
            setSending(true);
            try {
                const mimeType = 'audio/m4a';
                const uploadRes: any = await api.uploadMedia(tenantId, {
                    uri: result.uri,
                    fileName: `voice_${Date.now()}.m4a`,
                    mimeType,
                });
                if (!uploadRes?.success || !uploadRes.data?.url) throw new Error('upload_failed');
                await api.sendMediaMessage(tenantId, conversationId, uploadRes.data.url, '', user?.id, 'audio', `voice_${Date.now()}.m4a`);
                load();
            } catch {
                toast.error(t('conv.audioError'));
            } finally {
                setSending(false);
            }
        } else if (recState === 'idle') {
            haptic.tap();
            const ok = await startRecording();
            if (!ok) toast.error(t('conv.micPerm'));
        }
    };

    // Outbound media: pick from camera/gallery → upload → send as image message.
    const pickFrom = async (source: 'camera' | 'gallery') => {
        if (!tenantId) return;
        try {
            let res: ImagePicker.ImagePickerResult;
            if (source === 'camera') {
                const p = await ImagePicker.requestCameraPermissionsAsync();
                if (!p.granted) { toast.error(t('conv.cameraPerm')); return; }
                res = await ImagePicker.launchCameraAsync({ quality: 0.6 });
            } else {
                const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (!p.granted) { toast.error(t('conv.galleryPerm')); return; }
                res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
            }
            if (res.canceled || !res.assets?.[0]) return;
            const asset = res.assets[0];
            setSending(true);
            const up: any = await api.uploadMedia(tenantId, { uri: asset.uri, fileName: asset.fileName || undefined, mimeType: asset.mimeType || undefined });
            const url = up?.data?.url;
            if (!up?.success || !url) { toast.error(t('conv.mediaError')); return; }
            const absolute = String(url).startsWith('http') ? url : `${SOCKET_URL}${url}`;
            const r: any = await api.sendMediaMessage(tenantId, conversationId, absolute, '', user?.id);
            if (!r?.success) throw new Error('fail');
            haptic.success();
            load();
        } catch {
            toast.error(t('conv.mediaError'));
        } finally {
            setSending(false);
        }
    };
    const pickDocument = async () => {
        if (!tenantId) return;
        try {
            const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
            if (res.canceled || !res.assets?.[0]) return;
            const f = res.assets[0];
            setSending(true);
            const up: any = await api.uploadMedia(tenantId, { uri: f.uri, fileName: f.name, mimeType: f.mimeType || guessMime(f.name) });
            const url = up?.data?.url;
            if (!up?.success || !url) { toast.error(up?.error ? t('conv.mediaTypeError') : t('conv.mediaError')); return; }
            const absolute = String(url).startsWith('http') ? url : `${SOCKET_URL}${url}`;
            const r: any = await api.sendMediaMessage(tenantId, conversationId, absolute, '', user?.id, 'document', f.name);
            if (!r?.success) throw new Error('fail');
            haptic.success();
            load();
        } catch {
            toast.error(t('conv.mediaError'));
        } finally {
            setSending(false);
        }
    };
    const attachImage = () => {
        Alert.alert(t('conv.attachTitle'), undefined, [
            { text: t('conv.fromCamera'), onPress: () => pickFrom('camera') },
            { text: t('conv.fromGallery'), onPress: () => pickFrom('gallery') },
            { text: t('conv.fromDocument'), onPress: () => pickDocument() },
            { text: t('common.cancel'), style: 'cancel' },
        ]);
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
        <View style={{ flex: 1, backgroundColor: theme.bg, paddingBottom: kbSpace }}>
            {/* Who's responding + which channel — always visible so control is never ambiguous */}
            {conv && (
                <View style={styles.statusBanner}>
                    <View style={styles.authorChip} accessibilityLiveRegion="polite" accessible accessibilityLabel={t(AUTHOR[mode].key)}>
                        <Ionicons name={AUTHOR[mode].icon as any} size={14} color={AUTHOR[mode].color} />
                        <Text style={[styles.authorText, { color: AUTHOR[mode].color }]}>{t(AUTHOR[mode].key)}</Text>
                    </View>
                    {!!channel && (
                        <View style={[styles.channelChip, { borderColor: (channelColor[channel] || theme.border) + '99' }]}>
                            <Ionicons name={(channelIcon[channel] || 'chatbox') as any} size={12} color={channelColor[channel] || theme.textSecondary} />
                            <Text style={[styles.channelText, { color: channelColor[channel] || theme.textSecondary }]}>{channelLabel[channel] || channel}</Text>
                        </View>
                    )}
                </View>
            )}

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

            <View style={styles.actionBar}>
                <Action icon="information-circle-outline" label={t('conv.action.contact')} color={theme.textSecondary} onPress={() => setContactOpen(true)} />
                {/* Take control = assign to me (pauses the bot via handoff). Hidden once it's already mine. */}
                {!resolved && (mode === 'ai' || mode === 'waiting') &&
                    <Action icon="hand-left-outline" label={t('conv.action.takeControl')} color={theme.success} onPress={assignToMe} disabled={acting} />}
                {/* Return to AI = give the bot back control. Shown whenever a human currently holds it. */}
                {!resolved && mode !== 'ai' &&
                    <Action icon="sparkles-outline" label={t('conv.action.returnAi')} color={theme.accent} onPress={returnToAI} disabled={acting} />}
                {!resolved && <Action icon="people-outline" label={t('conv.action.reassign')} color={theme.textSecondary} onPress={openReassign} disabled={acting} />}
                <Action icon="document-text-outline" label={t('conv.action.summarize')} color={theme.textSecondary} onPress={doSummary} disabled={aiBusy} />
                <Action icon="create-outline" label={t('conv.action.note')} color={theme.warning} onPress={() => setNoteOpen(true)} disabled={acting} />
                <Action icon="moon-outline" label={t('conv.action.snooze')} color={theme.textSecondary} onPress={() => setSnoozeOpen(true)} disabled={acting} />
                {!resolved && <Action icon="checkmark-done-outline" label={t('conv.action.resolve')} color={theme.success} onPress={resolve} disabled={acting} />}
                {resolved && <Action icon="refresh-outline" label={t('conv.action.reopen')} color={theme.accent} onPress={doReopen} disabled={acting} />}
                {(acting || aiBusy) && <ActivityIndicator color={theme.accent} size="small" />}
            </View>

            <FlatList
                ref={listRef}
                data={reversedTimeline}
                inverted
                keyExtractor={(it, i) => it.id || String(i)}
                contentContainerStyle={{ padding: 12 }}
                // Inverted list: "end" is visually the top (oldest messages).
                // onEndReached triggers when the user scrolls up near the oldest loaded message.
                onEndReached={() => { if (hasMore && !loadingMore) loadMore(); }}
                onEndReachedThreshold={0.3}
                ListFooterComponent={
                    loadingMore
                        ? <ActivityIndicator color={theme.accent} style={{ marginVertical: 10 }} />
                        : hasMore
                            ? <TouchableOpacity onPress={loadMore} style={{ alignItems: 'center', paddingVertical: 10 }} accessibilityRole="button">
                                <Text style={{ color: theme.accent, fontSize: 13 }}>{t('conv.loadMore')}</Text>
                              </TouchableOpacity>
                            : null
                }
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
                    const docUrl = item.type === 'document' ? mediaUrl(item.metadata) : null;
                    const docName = item.metadata?.filename || item.metadata?.fileName;
                    const isAudio = item.type === 'audio' || item.type === 'voice';
                    const xlat = translations[item.id];
                    const isTranslating = translating === item.id;
                    return (
                        <View style={[styles.bubbleRow, { justifyContent: out ? 'flex-end' : 'flex-start' }]}>
                            <TouchableOpacity activeOpacity={0.8}
                                onPress={item.failed ? () => { haptic.tap(); retryOutbox(item.id); } : undefined}
                                onLongPress={() => onMsgLongPress(item as Msg)}
                                delayLongPress={350}
                                accessibilityRole={item.failed ? 'button' : undefined}
                                accessibilityLabel={item.failed ? t('conv.tapRetry') : undefined}
                                style={[styles.bubble, out ? styles.bubbleOut : styles.bubbleIn, item.failed && styles.bubbleFailed]}>
                                {img && <Image source={{ uri: img }} style={styles.media} resizeMode="cover" />}
                                {docUrl && (
                                    <TouchableOpacity style={styles.docChip} onPress={() => Linking.openURL(docUrl)} accessibilityRole="button" accessibilityLabel={docName || t('conv.document')}>
                                        <Ionicons name="document-text-outline" size={22} color={out ? '#fff' : theme.accent} />
                                        <Text style={[styles.docName, { color: out ? '#fff' : theme.text }]} numberOfLines={1}>{docName || t('conv.document')}</Text>
                                    </TouchableOpacity>
                                )}
                                {isAudio && <Text style={styles.mediaTag}>🎤 {t('conv.voiceNote')}</Text>}
                                {!!item.content && <Text style={[styles.bubbleText, item.pending && { opacity: 0.7 }]}>{item.content}</Text>}
                                {/* Inline translation */}
                                {isTranslating && <ActivityIndicator size="small" color={out ? '#fff' : theme.accent} style={{ marginTop: 4 }} />}
                                {xlat && (
                                    <View style={styles.xlat}>
                                        <Text style={styles.xlatLabel}>🌐</Text>
                                        <Text style={styles.xlatText}>{xlat}</Text>
                                    </View>
                                )}
                                <View style={styles.bubbleMeta}>
                                    {item.failed
                                        ? <Text style={styles.retryHint}><Ionicons name="alert-circle" size={11} color={theme.danger} /> {t('conv.tapRetry')}</Text>
                                        : item.pending
                                            ? <Ionicons name="time-outline" size={11} color="rgba(255,255,255,0.7)" />
                                            : <Text style={styles.bubbleTime}>{fmtTime(item.timestamp)}</Text>}
                                </View>
                            </TouchableOpacity>
                        </View>
                    );
                }}
            />

            {/* Reply / Quote strip */}
            {replyTo && (
                <View style={styles.replyStrip}>
                    <View style={styles.replyBar} />
                    <Text style={styles.replyLabel} numberOfLines={1}>
                        ↩ {replyTo.content.slice(0, 80)}{replyTo.content.length > 80 ? '…' : ''}
                    </Text>
                    <TouchableOpacity onPress={() => setReplyTo(null)} style={{ paddingLeft: 8 }} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
                        <Ionicons name="close" size={18} color={theme.textSecondary} />
                    </TouchableOpacity>
                </View>
            )}

            {/* Recording bar (replaces the composer while recording) */}
            {recState === 'recording' || recState === 'stopping' ? (
                <View style={styles.recBar}>
                    <View style={styles.recDot} />
                    <Text style={styles.recTimer}>{fmtDuration(recMs)}</Text>
                    <Text style={styles.recHint}>{t('conv.recHint')}</Text>
                    <TouchableOpacity onPress={cancelRecording} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
                        <Ionicons name="close-circle" size={24} color={theme.danger} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleMicPress} style={[styles.sendBtn, { backgroundColor: theme.danger }]}
                        disabled={recState === 'stopping'}
                        accessibilityRole="button" accessibilityLabel={t('conv.sendAudio')}>
                        {recState === 'stopping'
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Ionicons name="stop" size={20} color="#fff" />}
                    </TouchableOpacity>
                </View>
            ) : (
                <View style={styles.composer}>
                    {canned.length > 0 && (
                        <TouchableOpacity onPress={() => setCannedOpen(true)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('conv.cannedBtn')}><Ionicons name="albums-outline" size={22} color={theme.textSecondary} /></TouchableOpacity>
                    )}
                    {macros.length > 0 && (
                        <TouchableOpacity onPress={() => setMacrosOpen(true)} style={styles.iconBtn} disabled={acting} accessibilityRole="button" accessibilityLabel={t('conv.macrosBtn')}><Ionicons name="flash-outline" size={22} color={theme.warning} /></TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={attachImage} style={styles.iconBtn} disabled={sending} accessibilityRole="button" accessibilityLabel={t('conv.attach')}>
                        <Ionicons name="image-outline" size={22} color={theme.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={aiButton} style={styles.iconBtn} disabled={aiBusy} accessibilityRole="button" accessibilityLabel={t('conv.aiAssist')}>
                        {aiBusy ? <ActivityIndicator color={theme.accent} size="small" /> : <Ionicons name="sparkles-outline" size={22} color={theme.accent} />}
                    </TouchableOpacity>
                    <TextInput style={styles.input} placeholder={t('conv.composer')} placeholderTextColor={theme.textSecondary} value={text} onChangeText={setText} multiline />
                    {/* Mic button (visible only when input is empty) */}
                    {!text.trim() ? (
                        <TouchableOpacity onPress={handleMicPress} style={[styles.sendBtn, { backgroundColor: theme.bgCard, borderWidth: 1, borderColor: theme.border }]}
                            disabled={sending || recState === 'requesting'}
                            accessibilityRole="button" accessibilityLabel={t('conv.record')}>
                            {recState === 'requesting'
                                ? <ActivityIndicator color={theme.accent} size="small" />
                                : <Ionicons name="mic-outline" size={20} color={theme.accent} />}
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity onPress={send} style={styles.sendBtn} disabled={sending} accessibilityRole="button" accessibilityLabel={t('conv.send')}>
                            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={20} color="#fff" />}
                        </TouchableOpacity>
                    )}
                </View>
            )}

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
                            {!!(conv.contact.name || conv.contact.phone) && (
                                <TouchableOpacity style={styles.cAction} onPress={() => {
                                    setContactOpen(false);
                                    // Jump to the CRM tab with the contact prefilled in search (cross-navigation).
                                    nav.getParent()?.navigate('CRM', { screen: 'CrmList', params: { search: conv.contact.name || conv.contact.phone } });
                                }}>
                                    <Ionicons name="person-outline" size={18} color={theme.accent} /><Text style={styles.cActionText}>{t('conv.viewInCrm')}</Text>
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

            {/* Reassign to a colleague */}
            <Sheet visible={agentsOpen} title={t('conv.reassignSheet')} onClose={() => setAgentsOpen(false)}>
                {agents.filter((a) => agentIdOf(a) && agentIdOf(a) !== user?.id).length === 0 ? (
                    <Text style={styles.summaryText}>{t('conv.noAgents')}</Text>
                ) : (
                    <FlatList
                        data={agents.filter((a) => agentIdOf(a) && agentIdOf(a) !== user?.id)}
                        keyExtractor={(a, i) => agentIdOf(a) || String(i)}
                        renderItem={({ item }) => (
                            <TouchableOpacity style={styles.agentRow} onPress={() => reassignTo(agentIdOf(item))}
                                accessibilityRole="button" accessibilityLabel={agentNameOf(item)}>
                                <View style={[styles.agentDot, { backgroundColor: statusColor(item.status) }]} />
                                <Text style={styles.cannedTitle}>{agentNameOf(item)}</Text>
                            </TouchableOpacity>
                        )}
                    />
                )}
            </Sheet>
        </View>
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
    const insets = useSafeAreaInsets();
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
                <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose}>
                    <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onStartShouldSetResponder={() => true}>
                        <Text style={styles.sheetTitle}>{title}</Text>
                        {children}
                    </View>
                </TouchableOpacity>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
    statusBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 7, backgroundColor: theme.bgCard, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    authorChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    authorText: { fontSize: 12, fontWeight: '700' },
    channelChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
    channelText: { fontSize: 11, fontWeight: '700' },
    handoffBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.warning + '18', paddingHorizontal: 14, paddingVertical: 10 },
    handoffText: { color: theme.warning, fontSize: 13, flex: 1 },
    actionBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: theme.bgCard },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderColor: theme.border, borderWidth: 1 },
    actionBtnText: { fontSize: 13, fontWeight: '600' },
    bubbleRow: { flexDirection: 'row', marginVertical: 3 },
    bubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 5 },
    bubbleIn: { backgroundColor: theme.bubbleIn, borderBottomLeftRadius: 4 },
    bubbleOut: { backgroundColor: theme.bubbleOut, borderBottomRightRadius: 4 },
    bubbleFailed: { borderWidth: 1, borderColor: theme.danger },
    retryHint: { color: theme.danger, fontSize: 10, fontWeight: '700' },
    bubbleText: { color: theme.text, fontSize: 15 },
    bubbleTime: { color: theme.textSecondary, fontSize: 10, alignSelf: 'flex-end', marginTop: 2, opacity: 0.8 },
    bubbleMeta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 2 },
    media: { width: 200, height: 200, borderRadius: 10, marginBottom: 4 },
    mediaTag: { color: theme.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
    docChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingRight: 8, maxWidth: 240 },
    docName: { fontSize: 14, fontWeight: '600', flex: 1, textDecorationLine: 'underline' },
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
    agentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    agentDot: { width: 9, height: 9, borderRadius: 5 },
    // Recording bar
    recBar: { flexDirection: 'row', alignItems: 'center', padding: 8, gap: 8, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth, backgroundColor: theme.bgCard },
    recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger },
    recTimer: { color: theme.danger, fontSize: 15, fontWeight: '700', minWidth: 40 },
    recHint: { color: theme.textSecondary, fontSize: 12, flex: 1 },
    // Reply strip
    replyStrip: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bgCard, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
    replyBar: { width: 3, height: '100%', backgroundColor: theme.accent, borderRadius: 2, marginRight: 8 },
    replyLabel: { flex: 1, color: theme.textSecondary, fontSize: 13 },
    // Inline translation
    xlat: { marginTop: 6, paddingTop: 6, borderTopColor: 'rgba(255,255,255,0.2)', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 4 },
    xlatLabel: { fontSize: 12 },
    xlatText: { color: theme.textSecondary, fontSize: 13, flex: 1, fontStyle: 'italic' },
});
