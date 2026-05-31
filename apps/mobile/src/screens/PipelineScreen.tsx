import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, Modal } from 'react-native';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

interface Stage { id: string; name: string; slug?: string; color?: string; default_probability?: number }
interface Deal { id: string; title?: string; name?: string; contact_name?: string; value?: number; estimated_value?: number; stage_id?: string; stage?: string }

function dealTitle(d: Deal): string { return d.title || d.name || d.contact_name || 'Deal'; }
function dealValue(d: Deal): number { return Number(d.value ?? d.estimated_value ?? 0); }
const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function PipelineScreen() {
    const { tenantId } = useAuth();
    const [stages, setStages] = useState<Stage[]>([]);
    const [groups, setGroups] = useState<Record<string, Deal[]>>({});
    const [active, setActive] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [moving, setMoving] = useState<Deal | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        if (!tenantId) return;
        const [s, k]: any[] = await Promise.all([api.getPipelineStages(tenantId), api.getKanban(tenantId)]);
        const stageList: Stage[] = s?.success ? (Array.isArray(s.data) ? s.data : s.data?.stages || []) : [];
        setStages(stageList);

        // Normalize kanban into { stageId/slug: Deal[] }
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
        setGroups(g);
        if (!active && stageList.length) setActive(stageList[0].id);
        setLoading(false); setRefreshing(false);
    }, [tenantId, active]);

    useEffect(() => { load(); }, [load]);

    const dealsFor = (st: Stage): Deal[] => groups[st.id] || groups[st.slug || ''] || [];

    const activeStage = useMemo(() => stages.find((s) => s.id === active), [stages, active]);
    const activeDeals = activeStage ? dealsFor(activeStage) : [];

    const move = async (stageId: string) => {
        if (!tenantId || !moving) return;
        setBusy(true);
        await api.moveDeal(tenantId, moving.id, stageId);
        setMoving(null); setBusy(false);
        await load();
    };

    if (loading) return <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>;

    return (
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }}>
                {stages.map((st) => {
                    const count = dealsFor(st).length;
                    const on = st.id === active;
                    return (
                        <TouchableOpacity key={st.id} onPress={() => setActive(st.id)}
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
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
                ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>Sin deals en esta etapa.</Text></View>}
                renderItem={({ item }) => (
                    <TouchableOpacity style={styles.card} onPress={() => setMoving(item)}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.dealTitle} numberOfLines={1}>{dealTitle(item)}</Text>
                            {!!item.contact_name && <Text style={styles.dealSub} numberOfLines={1}>{item.contact_name}</Text>}
                        </View>
                        {dealValue(item) > 0 && <Text style={styles.value}>{money(dealValue(item))}</Text>}
                    </TouchableOpacity>
                )}
            />

            {/* Move modal */}
            <Modal visible={!!moving} transparent animationType="slide" onRequestClose={() => setMoving(null)}>
                <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setMoving(null)}>
                    <View style={styles.sheet}>
                        <Text style={styles.sheetTitle}>Mover «{moving ? dealTitle(moving) : ''}» a…</Text>
                        {stages.map((st) => (
                            <TouchableOpacity key={st.id} style={styles.stageOpt} disabled={busy} onPress={() => move(st.id)}>
                                <View style={[styles.dot, { backgroundColor: st.color || theme.accent }]} />
                                <Text style={styles.stageOptText}>{st.name}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </TouchableOpacity>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, backgroundColor: theme.bg },
    empty: { color: theme.textSecondary },
    chips: { maxHeight: 56, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgCard },
    chipText: { color: theme.textSecondary, fontSize: 13, fontWeight: '600' },
    card: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8, borderRadius: 12, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1 },
    dealTitle: { color: theme.text, fontSize: 15, fontWeight: '600' },
    dealSub: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
    value: { color: theme.success, fontSize: 15, fontWeight: '700' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: theme.bgCard, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: '70%' },
    sheetTitle: { color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
    stageOpt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    dot: { width: 10, height: 10, borderRadius: 5 },
    stageOptText: { color: theme.text, fontSize: 15 },
});
