import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, Modal, TextInput, Linking, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { haptic } from '../lib/haptics';
import { theme } from '../theme';

interface Stage { id: string; name: string; slug?: string; color?: string; default_probability?: number }
interface Deal {
    id: string; title?: string; name?: string; contact_name?: string; contact_phone?: string;
    value?: number; estimated_value?: number; stage_id?: string; stage?: string;
    probability?: number; score?: number; notes?: string; expected_close_date?: string;
    assigned_agent_id?: string; assignedAgentId?: string;
}

function dealTitle(d: Deal): string { return d.title || d.name || d.contact_name || 'Deal'; }
function dealValue(d: Deal): number { return Number(d.value ?? d.estimated_value ?? 0); }
const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const agentIdOf = (a: any): string => a?.userId || a?.user_id || a?.id || a?.agentId || '';
const agentNameOf = (a: any): string => a?.name || a?.agentName || a?.email || agentIdOf(a);
const statusColor = (s?: string): string => s === 'online' ? theme.success : s === 'away' ? theme.warning : theme.textSecondary;
function fmtDate(iso?: string): string { return iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }

export function PipelineScreen() {
    const { tenantId } = useAuth();
    const toast = useToast();
    const { t } = useI18n();
    const insets = useSafeAreaInsets();
    const [active, setActive] = useState<string>('');
    const queryClient = useQueryClient();
    const pipelineQKey = ['pipeline', tenantId];

    // Deal detail sheet state
    const [detail, setDetail] = useState<Deal | null>(null);
    const [detailStageId, setDetailStageId] = useState<string>('');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const [agentsOpen, setAgentsOpen] = useState(false);
    const [agents, setAgents] = useState<any[]>([]);

    // React Query: stages + kanban in parallel (2min stale).
    const { data: pipelineData, isLoading: loading, isFetching, isError, refetch } = useQuery({
        queryKey: pipelineQKey,
        queryFn: async () => {
            if (!tenantId) return { stages: [], groups: {} };
            const [s, k]: any[] = await Promise.all([api.getPipelineStages(tenantId), api.getKanban(tenantId)]);
            // Throw on failure so isError renders error+retry — an empty-stages fallback
            // made a failed fetch indistinguishable from a tenant with no deals.
            if (!s?.success) throw new Error(s?.error || 'load_failed');
            if (k?.success === false) throw new Error(k?.error || 'load_failed');
            const stageList: Stage[] = Array.isArray(s.data) ? s.data : s.data?.stages || [];
            const g: Record<string, Deal[]> = {};
            const kd = k?.data ?? k;
            const cols = Array.isArray(kd) ? kd : (kd?.stages || kd?.columns || []);
            if (Array.isArray(cols) && cols.length) {
                for (const col of cols) {
                    const key = col.id || col.stageId || col.stage || col.slug;
                    g[key] = col.deals || col.items || [];
                }
            } else if (kd && typeof kd === 'object') {
                for (const key of Object.keys(kd)) if (Array.isArray(kd[key])) g[key] = kd[key];
            }
            return { stages: stageList, groups: g };
        },
        staleTime: 2 * 60 * 1000,
        enabled: !!tenantId,
        throwOnError: false,
    });

    const stages = pipelineData?.stages ?? [];
    const groups = pipelineData?.groups ?? {};
    const refreshing = isFetching && !loading;

    // Set the first stage as active when stages load for the first time.
    useEffect(() => {
        if (!active && stages.length) setActive(stages[0].id);
    }, [stages, active]);

    const dealsFor = (st: Stage): Deal[] => groups[st.id] || groups[st.slug || ''] || [];
    const activeStage = useMemo(() => stages.find((s) => s.id === active), [stages, active]);
    const activeDeals = activeStage ? dealsFor(activeStage) : [];

    // Open the detail sheet for a deal and enrich it from the backend.
    const openDetail = useCallback(async (d: Deal, stageId: string) => {
        haptic.tap();
        setDetail(d); setDetailStageId(stageId); setNotes(d.notes || '');
        if (!tenantId) return;
        try {
            const r: any = await api.getDeal(tenantId, d.id);
            if (r?.success && r.data) {
                const full = { ...d, ...r.data };
                setDetail(full); setNotes(full.notes || '');
            }
        } catch { /* keep card-level data */ }
    }, [tenantId]);

    const closeDetail = () => { setDetail(null); setAgentsOpen(false); };

    // The transition-rules engine rejects moves with 400 'TRANSITION_RULE_FAILED:<type>[:extra]'
    // (and terminal stages with their own message). Map each rule to a human explanation —
    // same contract the web board handles — instead of a generic failure.
    const moveErrorMessage = (err?: string): string => {
        const s = err || '';
        if (s.includes('terminal stage')) return t('pipeline.ruleTerminal');
        const idx = s.indexOf('TRANSITION_RULE_FAILED');
        if (idx < 0) return t('pipeline.moveError');
        const parts = s.slice(idx).split(':');
        switch (parts[1]) {
            case 'email_required': return t('pipeline.ruleEmail');
            case 'phone_required': return t('pipeline.rulePhone');
            case 'name_required': return t('pipeline.ruleName');
            case 'min_score': return t('pipeline.ruleScore', { score: parts[2] || '0' });
            case 'agent_assigned': return t('pipeline.ruleAgent');
            case 'appointment_required': return t('pipeline.ruleAppointment');
            case 'order_required': return t('pipeline.ruleOrder');
            case 'offer_required': return t('pipeline.ruleOffer');
            case 'custom_attribute_required': return t('pipeline.ruleCustomRequired', { field: parts[2] || '' });
            case 'custom_attribute_equals': return t('pipeline.ruleCustomEquals', { field: parts[2] || '' });
            default: return t('pipeline.ruleGeneric');
        }
    };

    const move = async (stageId: string) => {
        if (!tenantId || !detail) return;
        setBusy(true);
        try {
            const r: any = await api.moveDeal(tenantId, detail.id, stageId);
            if (!r?.success) { toast.error(moveErrorMessage(r?.error)); return; }
            toast.success(t('pipeline.moved'));
            closeDetail();
            queryClient.invalidateQueries({ queryKey: pipelineQKey });
        } catch { toast.error(t('pipeline.moveError')); }
        finally { setBusy(false); }
    };

    const saveNotes = async () => {
        if (!tenantId || !detail) return;
        setBusy(true);
        try {
            const r: any = await api.updateDeal(tenantId, detail.id, { notes });
            if (!r?.success) throw new Error('fail');
            setDetail({ ...detail, notes });
            toast.success(t('pipeline.notesSaved'));
        } catch { toast.error(t('pipeline.notesError')); }
        finally { setBusy(false); }
    };

    const openAssign = async () => {
        if (!tenantId) return;
        setAgentsOpen(true);
        try { const r: any = await api.getAgentsStatus(tenantId); if (r?.success && Array.isArray(r.data)) setAgents(r.data); }
        catch { /* empty state */ }
    };
    const assignTo = async (agentId: string) => {
        setAgentsOpen(false);
        if (!tenantId || !detail || !agentId) return;
        setBusy(true);
        try {
            // PUT /pipeline/deals/:tenantId/:dealId with assignedAgentId is the assignment
            // contract. A same-stage moveDeal never writes assigned_agent_id and resets
            // probability/SLA as a side effect — it is NOT an assignment path.
            const r: any = await api.updateDeal(tenantId, detail.id, { assignedAgentId: agentId });
            if (!r?.success) { toast.error(t('pipeline.assignError')); return; }
            toast.success(t('pipeline.assigned'));
            closeDetail();
            queryClient.invalidateQueries({ queryKey: pipelineQKey });
        } catch { toast.error(t('pipeline.assignError')); }
        finally { setBusy(false); }
    };

    if (loading) return <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>;

    // Solo pantalla completa de error si NO hay datos: un refetch de fondo
    // fallido (React Query mantiene data con status 'error') no debe tapar
    // un tablero ya poblado con la pantalla offline.
    if (isError && !pipelineData) return (
        <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={40} color={theme.textSecondary} />
            <Text style={[styles.empty, { marginTop: 10 }]}>{t('pipeline.loadError')}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
        </View>
    );

    return (
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }}>
                {stages.map((st) => {
                    const count = dealsFor(st).length;
                    const on = st.id === active;
                    return (
                        <TouchableOpacity key={st.id} onPress={() => { haptic.tap(); setActive(st.id); }}
                            accessibilityRole="button" accessibilityState={{ selected: on }}
                            style={[styles.chip, on && { backgroundColor: (st.color || theme.accent) + '22', borderColor: st.color || theme.accent }]}>
                            <Text style={[styles.chipText, on && { color: theme.text }]}>{st.name} · {count}</Text>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>

            <FlatList
                data={activeDeals}
                keyExtractor={(d) => d.id}
                contentContainerStyle={{ padding: 12 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refetch()} tintColor={theme.accent} />}
                ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>{t('pipeline.empty')}</Text></View>}
                renderItem={({ item }) => (
                    <TouchableOpacity style={styles.card} onPress={() => openDetail(item, active)}
                        accessibilityRole="button" accessibilityLabel={dealTitle(item)}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.dealTitle} numberOfLines={1}>{dealTitle(item)}</Text>
                            {!!item.contact_name && <Text style={styles.dealSub} numberOfLines={1}>{item.contact_name}</Text>}
                        </View>
                        {dealValue(item) > 0 && <Text style={styles.value}>{money(dealValue(item))}</Text>}
                        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} style={{ marginLeft: 6 }} />
                    </TouchableOpacity>
                )}
            />

            {/* Deal detail sheet */}
            <Modal visible={!!detail} transparent animationType="slide" onRequestClose={closeDetail} statusBarTranslucent>
                <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
                <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeDetail}>
                    <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onStartShouldSetResponder={() => true}>
                        {detail && (
                            <ScrollView keyboardShouldPersistTaps="handled">
                                <View style={styles.sheetHead}>
                                    <Text style={styles.sheetTitle} numberOfLines={2}>{dealTitle(detail)}</Text>
                                    {dealValue(detail) > 0 && <Text style={styles.sheetValue}>{money(dealValue(detail))}</Text>}
                                </View>

                                <Row label={t('pipeline.field.contact')} value={detail.contact_name} />
                                <Row label={t('pipeline.field.stage')} value={detail.stage || activeStage?.name} />
                                <Row label={t('pipeline.field.probability')} value={detail.probability != null ? `${detail.probability}%` : undefined} />
                                <Row label={t('pipeline.field.score')} value={detail.score != null ? String(detail.score) : undefined} />
                                <Row label={t('pipeline.field.closeDate')} value={fmtDate(detail.expected_close_date)} />

                                {!!detail.contact_phone && (
                                    <View style={styles.quickRow}>
                                        <TouchableOpacity style={styles.quickBtn} onPress={() => Linking.openURL(`tel:${detail.contact_phone}`)}>
                                            <Ionicons name="call-outline" size={16} color={theme.accent} /><Text style={styles.quickText}>{t('crm.call')}</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={styles.quickBtn} onPress={() => Linking.openURL(`https://wa.me/${String(detail.contact_phone).replace(/[^0-9]/g, '')}`)}>
                                            <Ionicons name="logo-whatsapp" size={16} color={theme.success} /><Text style={[styles.quickText, { color: theme.success }]}>WhatsApp</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}

                                {/* Editable notes */}
                                <Text style={styles.sectionLabel}>{t('pipeline.field.notes')}</Text>
                                <TextInput style={styles.notesInput} placeholder={t('pipeline.notesPlaceholder')} placeholderTextColor={theme.textSecondary}
                                    value={notes} onChangeText={setNotes} multiline />
                                <TouchableOpacity style={[styles.primaryBtn, (busy || notes === (detail.notes || '')) && { opacity: 0.5 }]} onPress={saveNotes} disabled={busy || notes === (detail.notes || '')}>
                                    <Text style={styles.primaryText}>{t('pipeline.saveNotes')}</Text>
                                </TouchableOpacity>

                                {/* Assign agent */}
                                <Text style={styles.sectionLabel}>{t('pipeline.assign')}</Text>
                                <TouchableOpacity style={styles.outlineBtn} onPress={openAssign} disabled={busy}>
                                    <Ionicons name="people-outline" size={16} color={theme.accent} />
                                    <Text style={styles.outlineText}>{t('pipeline.assignBtn')}</Text>
                                </TouchableOpacity>

                                {/* Move to stage */}
                                <Text style={styles.sectionLabel}>{t('pipeline.moveSection')}</Text>
                                {stages.filter((st) => st.id !== (detailStageId || detail.stage_id)).map((st) => (
                                    <TouchableOpacity key={st.id} style={styles.stageOpt} disabled={busy} onPress={() => move(st.id)}
                                        accessibilityRole="button" accessibilityLabel={st.name}>
                                        <View style={[styles.dot, { backgroundColor: st.color || theme.accent }]} />
                                        <Text style={styles.stageOptText}>{st.name}</Text>
                                    </TouchableOpacity>
                                ))}
                                {busy && <ActivityIndicator color={theme.accent} style={{ marginTop: 10 }} />}
                            </ScrollView>
                        )}
                    </View>
                </TouchableOpacity>
                </KeyboardAvoidingView>
            </Modal>

            {/* Agent picker */}
            <Modal visible={agentsOpen} transparent animationType="slide" onRequestClose={() => setAgentsOpen(false)}>
                <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setAgentsOpen(false)}>
                    <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onStartShouldSetResponder={() => true}>
                        <Text style={styles.sheetTitle}>{t('pipeline.assignBtn')}</Text>
                        {agents.length === 0 ? (
                            <Text style={styles.empty}>{t('pipeline.noAgents')}</Text>
                        ) : agents.map((a, i) => (
                            <TouchableOpacity key={agentIdOf(a) || i} style={styles.stageOpt} onPress={() => assignTo(agentIdOf(a))}>
                                <View style={[styles.dot, { backgroundColor: statusColor(a.status) }]} />
                                <Text style={styles.stageOptText}>{agentNameOf(a)}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </TouchableOpacity>
            </Modal>
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
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, backgroundColor: theme.bg },
    empty: { color: theme.textSecondary },
    retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, backgroundColor: theme.accent, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
    retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    chips: { maxHeight: 56, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgCard },
    chipText: { color: theme.textSecondary, fontSize: 13, fontWeight: '600' },
    card: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8, borderRadius: 12, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1 },
    dealTitle: { color: theme.text, fontSize: 15, fontWeight: '600' },
    dealSub: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
    value: { color: theme.success, fontSize: 15, fontWeight: '700' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.bgCard, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: '85%' },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10 },
    sheetTitle: { color: theme.text, fontSize: 17, fontWeight: '700', flex: 1 },
    sheetValue: { color: theme.success, fontSize: 17, fontWeight: '700' },
    kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    k: { color: theme.textSecondary, fontSize: 14 },
    v: { color: theme.text, fontSize: 14, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
    quickRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
    quickBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: theme.bg, borderColor: theme.border, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
    quickText: { color: theme.accent, fontWeight: '600', fontSize: 13 },
    sectionLabel: { color: theme.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
    notesInput: { backgroundColor: theme.bg, borderColor: theme.border, borderWidth: 1, borderRadius: 10, padding: 12, color: theme.text, fontSize: 14, minHeight: 70, textAlignVertical: 'top' },
    primaryBtn: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
    primaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    outlineBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderColor: theme.border, borderWidth: 1, borderRadius: 10, paddingVertical: 11 },
    outlineText: { color: theme.accent, fontSize: 14, fontWeight: '600' },
    stageOpt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    dot: { width: 10, height: 10, borderRadius: 5 },
    stageOptText: { color: theme.text, fontSize: 15 },
});
