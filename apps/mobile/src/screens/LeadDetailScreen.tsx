import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Linking, TouchableOpacity } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n';
import { theme } from '../theme';

export function LeadDetailScreen() {
    const route = useRoute<any>();
    const { leadId } = route.params;
    const { tenantId } = useAuth();
    const { t } = useI18n();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!tenantId) return;
        const res: any = await api.getLead(tenantId, leadId);
        if (res?.success) setData(res.data);
        setLoading(false);
    }, [tenantId, leadId]);

    useEffect(() => { load(); }, [load]);

    if (loading) return <View style={styles.center}><ActivityIndicator color={theme.accent} size="large" /></View>;
    if (!data?.lead) return <View style={styles.center}><Text style={styles.muted}>{t('crm.notFound')}</Text></View>;

    const l = data.lead;
    const name = `${l.first_name || ''} ${l.last_name || ''}`.trim() || l.contact_name || 'Lead';
    const opps = data.opportunities || [];
    const tags = data.tags || [];

    return (
        <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16 }}>
            <View style={styles.header}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text></View>
                <Text style={styles.name}>{name}</Text>
                {!!l.stage && <Text style={styles.stage}>{l.stage} · {t('crm.score', { n: l.score ?? 0 })}</Text>}
            </View>

            <View style={styles.actions}>
                {!!l.phone && (
                    <TouchableOpacity style={styles.action} onPress={() => Linking.openURL(`tel:${l.phone}`)}>
                        <Ionicons name="call-outline" size={18} color={theme.accent} /><Text style={styles.actionText}>{t('crm.call')}</Text>
                    </TouchableOpacity>
                )}
                {!!(l.email || l.contact_email) && (
                    <TouchableOpacity style={styles.action} onPress={() => Linking.openURL(`mailto:${l.email || l.contact_email}`)}>
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

            {tags.length > 0 && (
                <Section title={t('crm.section.tags')}>
                    <View style={styles.tags}>
                        {tags.map((t: any, i: number) => (
                            <View key={i} style={[styles.tag, { backgroundColor: (t.color || theme.accent) + '22' }]}>
                                <Text style={[styles.tagText, { color: t.color || theme.accent }]}>{t.name}</Text>
                            </View>
                        ))}
                    </View>
                </Section>
            )}

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
        </ScrollView>
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
    actions: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 16 },
    action: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
    actionText: { color: theme.accent, fontWeight: '600' },
    section: { backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
    sectionTitle: { color: theme.text, fontWeight: '700', fontSize: 13, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
    kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
    k: { color: theme.textSecondary, fontSize: 14 },
    v: { color: theme.text, fontSize: 14, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
    tagText: { fontSize: 12, fontWeight: '600' },
    opp: { paddingVertical: 8, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
    oppName: { color: theme.text, fontSize: 14, fontWeight: '600' },
    oppMeta: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
});
