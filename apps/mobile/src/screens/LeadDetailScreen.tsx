import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Linking, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { haptic } from '../lib/haptics';
import { theme } from '../theme';

function tagNamesOf(tags: any[]): string[] {
    return (tags || []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
}
function fmtDate(iso?: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function LeadDetailScreen() {
    const route = useRoute<any>();
    const nav = useNavigation<any>();
    const { leadId } = route.params;
    const { tenantId, user } = useAuth();
    const { t } = useI18n();
    const toast = useToast();
    const headerHeight = useHeaderHeight();
    const [data, setData] = useState<any>(null);
    const [notes, setNotes] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [tasks, setTasks] = useState<any[]>([]);
    const [tagInput, setTagInput] = useState('');
    const [noteText, setNoteText] = useState('');
    const [taskTitle, setTaskTitle] = useState('');
    const [savingTag, setSavingTag] = useState(false);
    const [savingNote, setSavingNote] = useState(false);
    const [savingTask, setSavingTask] = useState(false);

    const loadNotes = useCallback(async () => {
        if (!tenantId) return;
        try {
            const r: any = await api.getLeadNotes(tenantId, leadId);
            if (r?.success) setNotes(Array.isArray(r.data) ? r.data : (r.data?.notes || []));
        } catch { /* non-critical: notes just stay empty */ }
    }, [tenantId, leadId]);

    const loadTasks = useCallback(async () => {
        if (!tenantId) return;
        try {
            const r: any = await api.getTasks(tenantId, `leadId=${leadId}`);
            if (r?.success) setTasks(Array.isArray(r.data) ? r.data : (r.data?.tasks || []));
        } catch { /* non-critical: tasks just stay empty */ }
    }, [tenantId, leadId]);

    const load = useCallback(async () => {
        if (!tenantId) return;
        try {
            const res: any = await api.getLead(tenantId, leadId);
            if (res?.success) setData(res.data);
        } catch {
            toast.error(t('common.loadError'));
        } finally {
            setLoading(false);
        }
    }, [tenantId, leadId, toast, t]);

    useEffect(() => { load(); loadNotes(); loadTasks(); }, [load, loadNotes, loadTasks]);

    // Persist a new tag set (the backend takes the full array on PUT /crm/leads).
    const saveTags = useCallback(async (names: string[]) => {
        if (!tenantId) return;
        const prevTags = tagNamesOf(data?.tags); // capture only tags, not the whole record
        setData((d: any) => (d ? { ...d, tags: names.map((n) => ({ name: n })) } : d)); // optimistic
        setSavingTag(true);
        try {
            const r: any = await api.updateLead(tenantId, leadId, { tags: names });
            if (!r?.success) throw new Error('fail');
            toast.success(t('crm.tagsUpdated'));
        } catch {
            setData((d: any) => (d ? { ...d, tags: prevTags.map((n) => ({ name: n })) } : d)); // rollback tags only
            toast.error(t('crm.tagUpdateError'));
        } finally { setSavingTag(false); }
    }, [tenantId, leadId, data, toast, t]);

    const addTag = () => {
        const v = tagInput.trim();
        if (!v) return;
        const names = tagNamesOf(data?.tags);
        if (names.some((n) => n.toLowerCase() === v.toLowerCase())) { setTagInput(''); return; }
        haptic.tap();
        setTagInput('');
        saveTags([...names, v]);
    };
    const removeTag = (name: string) => {
        haptic.tap();
        saveTags(tagNamesOf(data?.tags).filter((n) => n !== name));
    };

    const addNote = async () => {
        if (!tenantId || !noteText.trim()) return;
        setSavingNote(true);
        try {
            const r: any = await api.addLeadNote(tenantId, leadId, noteText.trim(), user?.id);
            if (!r?.success) throw new Error('fail');
            setNoteText('');
            toast.success(t('crm.noteAdded'));
            loadNotes();
        } catch {
            toast.error(t('crm.noteError'));
        } finally { setSavingNote(false); }
    };

    const isTaskDone = (tk: any) => ['completed', 'done', 'closed'].includes(String(tk.status || '').toLowerCase());
    const addTask = async () => {
        if (!tenantId || !taskTitle.trim()) return;
        setSavingTask(true);
        try {
            const r: any = await api.createTask(tenantId, { leadId, title: taskTitle.trim(), assignedTo: user?.id, createdBy: user?.id });
            if (!r?.success) throw new Error('fail');
            setTaskTitle('');
            toast.success(t('crm.taskAdded'));
            loadTasks();
        } catch {
            toast.error(t('crm.taskError'));
        } finally { setSavingTask(false); }
    };
    const toggleTask = async (tk: any) => {
        if (!tenantId) return;
        const done = isTaskDone(tk);
        const next = done ? 'pending' : 'completed';
        haptic.tap();
        setTasks((prev) => prev.map((x) => (x.id === tk.id ? { ...x, status: next } : x))); // optimistic
        try {
            const r: any = await api.updateTaskStatus(tenantId, tk.id, next);
            if (!r?.success) throw new Error('fail');
            toast.success(done ? t('crm.taskReopened') : t('crm.taskDone'));
        } catch {
            setTasks((prev) => prev.map((x) => (x.id === tk.id ? { ...x, status: tk.status } : x))); // rollback
            toast.error(t('crm.taskStatusError'));
        }
    };

    if (loading) return <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>;
    if (!data?.lead) return <View style={styles.center}><Text style={styles.muted}>{t('crm.notFound')}</Text></View>;

    const l = data.lead;
    const name = `${l.first_name || ''} ${l.last_name || ''}`.trim() || l.contact_name || 'Lead';
    const opps = data.opportunities || [];
    const tags = tagNamesOf(data.tags);
    const archived = !!(l.is_archived || l.archived_at);

    const toggleArchive = () => {
        Alert.alert(
            archived ? t('crm.restore') : t('crm.archive'),
            archived ? t('crm.restoreConfirmMsg') : t('crm.archiveConfirmMsg'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: archived ? t('crm.restore') : t('crm.archive'),
                    style: archived ? 'default' : 'destructive',
                    onPress: async () => {
                        if (!tenantId) return;
                        try {
                            const r: any = archived ? await api.restoreLead(tenantId, leadId) : await api.archiveLead(tenantId, leadId);
                            if (!r?.success) throw new Error('fail');
                            if (archived) { toast.success(t('crm.restored')); load(); }
                            else { toast.success(t('crm.archived')); nav.goBack(); }
                        } catch {
                            toast.error(archived ? t('crm.restoreError') : t('crm.archiveError'));
                        }
                    },
                },
            ],
        );
    };

    return (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior="height" keyboardVerticalOffset={headerHeight}>
        <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <View style={styles.header}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text></View>
                <Text style={styles.name}>{name}</Text>
                {!!l.stage && <Text style={styles.stage}>{l.stage} · {t('crm.score', { n: l.score ?? 0 })}</Text>}
                {archived && <Text style={styles.archivedTag}>{t('crm.archivedBadge')}</Text>}
            </View>

            <View style={styles.actions}>
                {!!l.phone && (
                    <TouchableOpacity style={styles.action} onPress={() => Linking.openURL(`tel:${l.phone}`)}
                        accessibilityRole="button" accessibilityLabel={t('crm.call')}>
                        <Ionicons name="call-outline" size={18} color={theme.accent} /><Text style={styles.actionText}>{t('crm.call')}</Text>
                    </TouchableOpacity>
                )}
                {!!l.phone && (
                    <TouchableOpacity style={styles.action} onPress={() => Linking.openURL(`https://wa.me/${String(l.phone).replace(/[^0-9]/g, '')}`)}
                        accessibilityRole="button" accessibilityLabel="WhatsApp">
                        <Ionicons name="logo-whatsapp" size={18} color={theme.success} /><Text style={[styles.actionText, { color: theme.success }]}>WhatsApp</Text>
                    </TouchableOpacity>
                )}
                {!!(l.email || l.contact_email) && (
                    <TouchableOpacity style={styles.action} onPress={() => Linking.openURL(`mailto:${l.email || l.contact_email}`)}
                        accessibilityRole="button" accessibilityLabel={t('crm.email')}>
                        <Ionicons name="mail-outline" size={18} color={theme.accent} /><Text style={styles.actionText}>{t('crm.email')}</Text>
                    </TouchableOpacity>
                )}
            </View>

            <Section title={t('crm.section.data')}>
                <Row label={t('crm.field.phone')} value={l.phone} />
                <Row label={t('crm.email')} value={l.email || l.contact_email} />
                <Row label={t('crm.field.company')} value={l.company_name} />
                <Row label={t('crm.field.stage')} value={l.stage} />
                <Row label={t('crm.field.score')} value={l.score != null ? String(l.score) : undefined} />
            </Section>

            {/* Editable tags */}
            <Section title={t('crm.section.tags')}>
                <View style={styles.tags}>
                    {tags.map((name, i) => (
                        <View key={i} style={styles.tag}>
                            <Text style={styles.tagText}>{name}</Text>
                            <TouchableOpacity onPress={() => removeTag(name)} disabled={savingTag} hitSlop={8}
                                accessibilityRole="button" accessibilityLabel={t('crm.removeTag', { name })}>
                                <Ionicons name="close" size={13} color={theme.accent} />
                            </TouchableOpacity>
                        </View>
                    ))}
                    {tags.length === 0 && <Text style={styles.muted}>{t('crm.noTags')}</Text>}
                </View>
                <View style={styles.inlineInput}>
                    <TextInput style={styles.tagInput} placeholder={t('crm.addTag')} placeholderTextColor={theme.textSecondary}
                        value={tagInput} onChangeText={setTagInput} onSubmitEditing={addTag} autoCapitalize="none" returnKeyType="done" />
                    <TouchableOpacity style={styles.addBtn} onPress={addTag} disabled={savingTag || !tagInput.trim()}
                        accessibilityRole="button" accessibilityLabel={t('crm.addTag')}>
                        <Ionicons name="add" size={20} color="#fff" />
                    </TouchableOpacity>
                </View>
            </Section>

            {/* Quick note + notes list */}
            <Section title={t('crm.section.notes')}>
                <View style={styles.inlineInput}>
                    <TextInput style={[styles.tagInput, { minHeight: 38 }]} placeholder={t('crm.notePlaceholder')} placeholderTextColor={theme.textSecondary}
                        value={noteText} onChangeText={setNoteText} multiline />
                    <TouchableOpacity style={styles.addBtn} onPress={addNote} disabled={savingNote || !noteText.trim()}
                        accessibilityRole="button" accessibilityLabel={t('crm.addNote')}>
                        {savingNote ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
                    </TouchableOpacity>
                </View>
                {notes.length === 0 ? (
                    <Text style={[styles.muted, { marginTop: 8 }]}>{t('crm.noNotes')}</Text>
                ) : notes.map((n: any, i: number) => (
                    <View key={n.id || i} style={styles.note}>
                        <Text style={styles.noteContent}>{n.content}</Text>
                        <Text style={styles.noteMeta}>{[n.created_by_name || n.createdByName, fmtDate(n.created_at || n.createdAt)].filter(Boolean).join(' · ')}</Text>
                    </View>
                ))}
            </Section>

            {/* Tasks / follow-ups */}
            <Section title={t('crm.section.tasks')}>
                <View style={styles.inlineInput}>
                    <TextInput style={styles.tagInput} placeholder={t('crm.taskPlaceholder')} placeholderTextColor={theme.textSecondary}
                        value={taskTitle} onChangeText={setTaskTitle} onSubmitEditing={addTask} returnKeyType="done" />
                    <TouchableOpacity style={styles.addBtn} onPress={addTask} disabled={savingTask || !taskTitle.trim()}
                        accessibilityRole="button" accessibilityLabel={t('crm.addTask')}>
                        {savingTask ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="add" size={20} color="#fff" />}
                    </TouchableOpacity>
                </View>
                {tasks.length === 0 ? (
                    <Text style={[styles.muted, { marginTop: 8 }]}>{t('crm.noTasks')}</Text>
                ) : tasks.map((tk: any, i: number) => {
                    const done = isTaskDone(tk);
                    return (
                        <TouchableOpacity key={tk.id || i} style={styles.taskRow} onPress={() => toggleTask(tk)}
                            accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={tk.title}>
                            <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={done ? theme.success : theme.textSecondary} />
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.taskTitle, done && styles.taskDoneText]}>{tk.title}</Text>
                                {!!(tk.due_at || tk.dueAt) && <Text style={styles.taskDue}>{t('crm.taskDue', { date: fmtDate(tk.due_at || tk.dueAt) })}</Text>}
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </Section>

            {opps.length > 0 && (
                <Section title={t('crm.section.opportunities', { n: opps.length })}>
                    {opps.map((o: any) => (
                        <View key={o.id} style={styles.opp}>
                            <Text style={styles.oppName}>{o.course_name || o.name || t('crm.opportunity')}</Text>
                            <Text style={styles.oppMeta}>{o.stage} · {o.estimated_value ? `$${Number(o.estimated_value).toLocaleString()}` : '—'} {o.currency || ''}</Text>
                        </View>
                    ))}
                </Section>
            )}

            {/* Archive / restore */}
            <TouchableOpacity style={styles.archiveBtn} onPress={toggleArchive}
                accessibilityRole="button" accessibilityLabel={archived ? t('crm.restore') : t('crm.archive')}>
                <Ionicons name={archived ? 'archive-outline' : 'archive'} size={18} color={archived ? theme.accent : theme.danger} />
                <Text style={[styles.archiveText, { color: archived ? theme.accent : theme.danger }]}>{archived ? t('crm.restore') : t('crm.archive')}</Text>
            </TouchableOpacity>
        </ScrollView>
        </KeyboardAvoidingView>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {children}
        </View>
    );
}
function Row({ label, value }: { label: string; value?: string }) {
    if (!value) return null;
    return (
        <View style={styles.kv}>
            <Text style={styles.k}>{label}</Text>
            <Text style={styles.v}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
    muted: { color: theme.textSecondary },
    header: { alignItems: 'center', marginBottom: 20 },
    avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.accent + '33', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    avatarText: { color: theme.accent, fontWeight: '700', fontSize: 26 },
    name: { color: theme.text, fontSize: 20, fontWeight: '700' },
    stage: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
    archivedTag: { color: theme.warning, fontSize: 12, fontWeight: '700', marginTop: 6 },
    actions: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
    action: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
    actionText: { color: theme.accent, fontWeight: '600' },
    section: { backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
    sectionTitle: { color: theme.text, fontWeight: '700', fontSize: 13, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
    kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
    k: { color: theme.textSecondary, fontSize: 14 },
    v: { color: theme.text, fontSize: 14, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    tag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: theme.accent + '22' },
    tagText: { fontSize: 12, fontWeight: '600', color: theme.accent },
    inlineInput: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tagInput: { flex: 1, backgroundColor: theme.bg, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: theme.text, fontSize: 14 },
    addBtn: { backgroundColor: theme.accent, width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    note: { paddingVertical: 8, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8 },
    noteContent: { color: theme.text, fontSize: 14 },
    noteMeta: { color: theme.textSecondary, fontSize: 11, marginTop: 3 },
    taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8 },
    taskTitle: { color: theme.text, fontSize: 14 },
    taskDoneText: { color: theme.textSecondary, textDecorationLine: 'line-through' },
    taskDue: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
    opp: { paddingVertical: 8, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
    oppName: { color: theme.text, fontSize: 14, fontWeight: '600' },
    oppMeta: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
    archiveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginTop: 4, borderRadius: 12, borderWidth: 1, borderColor: theme.border },
    archiveText: { fontSize: 15, fontWeight: '600' },
});
