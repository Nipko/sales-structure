import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, ScrollView, TouchableOpacity, Switch, TextInput,
    StyleSheet, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useI18n } from '../i18n';
import { useToast } from '../components/Toast';
import { haptic } from '../lib/haptics';
import { getNotifPrefs, setNotifPrefs, NotifPrefs } from '../lib/notifPrefs';
import { theme } from '../theme';

// ── Troubleshooter ───────────────────────────────────────────────────────────
type PermStatus = 'granted' | 'denied' | 'undetermined' | 'checking';
const STATUS_COLOR: Record<PermStatus, string> = {
    granted: theme.success,
    denied: theme.danger,
    undetermined: theme.warning,
    checking: theme.textSecondary,
};
const STATUS_ICON: Record<PermStatus, string> = {
    granted: 'checkmark-circle',
    denied: 'close-circle',
    undetermined: 'alert-circle',
    checking: 'ellipse',
};

// ── Time input helpers ───────────────────────────────────────────────────────
function isValidTime(s: string): boolean {
    return /^\d{2}:\d{2}$/.test(s) && Number(s.split(':')[0]) < 24 && Number(s.split(':')[1]) < 60;
}
function formatTime(s: string): string {
    // Accepts "HH:MM" or partial inputs → normalizes
    const digits = s.replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

// ── Component ────────────────────────────────────────────────────────────────
export function NotificationPrefsScreen() {
    const { t } = useI18n();
    const toast = useToast();

    const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
    const [saving, setSaving] = useState(false);
    const [permStatus, setPermStatus] = useState<PermStatus>('checking');
    const [dndStartInput, setDndStartInput] = useState('22:00');
    const [dndEndInput, setDndEndInput] = useState('08:00');

    // Load saved prefs + check OS permission
    useEffect(() => {
        (async () => {
            const [p, perm] = await Promise.all([
                getNotifPrefs(),
                Notifications.getPermissionsAsync().catch(() => null),
            ]);
            setPrefs(p);
            setDndStartInput(p.dndStart);
            setDndEndInput(p.dndEnd);
            const s = perm?.status;
            setPermStatus(s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'undetermined');
        })();
    }, []);

    const save = useCallback(async (patch: Partial<NotifPrefs>) => {
        if (!prefs) return;
        haptic.tap();
        setSaving(true);
        try {
            const next: NotifPrefs = {
                ...prefs,
                ...patch,
                categories: { ...prefs.categories, ...(patch.categories || {}) },
            };
            setPrefs(next);
            await setNotifPrefs(patch);
        } catch {
            toast.error(t('common.saveError'));
        } finally {
            setSaving(false);
        }
    }, [prefs, toast, t]);

    const saveTime = useCallback(async () => {
        if (!isValidTime(dndStartInput) || !isValidTime(dndEndInput)) {
            toast.error(t('notifPrefs.invalidTime'));
            return;
        }
        await save({ dndStart: dndStartInput, dndEnd: dndEndInput });
        toast.success(t('notifPrefs.saved'));
    }, [dndStartInput, dndEndInput, save, toast, t]);

    const requestPerm = useCallback(async () => {
        haptic.tap();
        setPermStatus('checking');
        const result = await Notifications.requestPermissionsAsync().catch(() => null);
        const s = result?.status;
        if (s === 'granted') {
            setPermStatus('granted');
            toast.success(t('notifPrefs.permGranted'));
        } else if (s === 'denied') {
            setPermStatus('denied');
            // OS denegó definitivamente → abrir Ajustes del SO
            await Linking.openSettings();
        } else {
            setPermStatus('undetermined');
        }
    }, [toast, t]);

    if (!prefs) {
        return (
            <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }} edges={['top']}>
                <ActivityIndicator color={theme.accent} />
            </SafeAreaView>
        );
    }

    const catKeys: (keyof NotifPrefs['categories'])[] = ['handoff', 'messages', 'sla', 'appointments'];

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>
            <ScrollView contentContainerStyle={{ padding: 16 }}>

                {/* ── Troubleshooter de permisos ── */}
                <Text style={styles.section}>{t('notifPrefs.permSection')}</Text>
                <View style={styles.card}>
                    <View style={styles.row}>
                        <Ionicons
                            name={STATUS_ICON[permStatus] as any}
                            size={20}
                            color={STATUS_COLOR[permStatus]}
                        />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.rowLabel}>{t('notifPrefs.osPerm')}</Text>
                            <Text style={[styles.rowSub, { color: STATUS_COLOR[permStatus] }]}>
                                {t(`notifPrefs.perm.${permStatus}`)}
                            </Text>
                        </View>
                        {permStatus !== 'granted' && (
                            <TouchableOpacity
                                style={styles.fixBtn}
                                onPress={requestPerm}
                                accessibilityRole="button"
                                accessibilityLabel={t('notifPrefs.fix')}
                            >
                                <Text style={styles.fixBtnText}>{t('notifPrefs.fix')}</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                    {permStatus === 'denied' && (
                        <Text style={styles.hint}>{t('notifPrefs.deniedHint')}</Text>
                    )}
                    {permStatus === 'granted' && (
                        <Text style={[styles.hint, { color: theme.success }]}>{t('notifPrefs.permOk')}</Text>
                    )}
                </View>

                {/* ── DND ── */}
                <Text style={[styles.section, { marginTop: 20 }]}>{t('notifPrefs.dndSection')}</Text>
                <View style={styles.card}>
                    <View style={styles.row}>
                        <Ionicons name="moon-outline" size={20} color={theme.accent} />
                        <Text style={[styles.rowLabel, { flex: 1, marginLeft: 10 }]}>{t('notifPrefs.dnd')}</Text>
                        {saving && <ActivityIndicator size="small" color={theme.accent} style={{ marginRight: 6 }} />}
                        <Switch
                            value={prefs.dndEnabled}
                            onValueChange={(v) => save({ dndEnabled: v })}
                            trackColor={{ true: theme.accent }}
                            thumbColor="#fff"
                            accessibilityLabel={t('notifPrefs.dnd')}
                        />
                    </View>
                    <Text style={styles.hint}>{t('notifPrefs.dndHint')}</Text>

                    {prefs.dndEnabled && (
                        <View style={styles.timeRow}>
                            <View style={styles.timeField}>
                                <Text style={styles.timeLabel}>{t('notifPrefs.dndFrom')}</Text>
                                <TextInput
                                    style={styles.timeInput}
                                    value={dndStartInput}
                                    onChangeText={(v) => setDndStartInput(formatTime(v))}
                                    onBlur={saveTime}
                                    keyboardType="numeric"
                                    maxLength={5}
                                    placeholder="22:00"
                                    placeholderTextColor={theme.textSecondary}
                                    accessibilityLabel={t('notifPrefs.dndFrom')}
                                />
                            </View>
                            <Ionicons name="arrow-forward" size={16} color={theme.textSecondary} style={{ marginTop: 22 }} />
                            <View style={styles.timeField}>
                                <Text style={styles.timeLabel}>{t('notifPrefs.dndTo')}</Text>
                                <TextInput
                                    style={styles.timeInput}
                                    value={dndEndInput}
                                    onChangeText={(v) => setDndEndInput(formatTime(v))}
                                    onBlur={saveTime}
                                    keyboardType="numeric"
                                    maxLength={5}
                                    placeholder="08:00"
                                    placeholderTextColor={theme.textSecondary}
                                    accessibilityLabel={t('notifPrefs.dndTo')}
                                />
                            </View>
                        </View>
                    )}
                </View>

                {/* ── Categorías ── */}
                <Text style={[styles.section, { marginTop: 20 }]}>{t('notifPrefs.catSection')}</Text>
                <View style={styles.card}>
                    {catKeys.map((cat, idx) => (
                        <View key={cat} style={[
                            styles.row,
                            idx > 0 && { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 0, paddingTop: 12 },
                        ]}>
                            <Ionicons
                                name={CAT_ICON[cat] as any}
                                size={18}
                                color={prefs.categories[cat] ? theme.accent : theme.textSecondary}
                            />
                            <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={styles.rowLabel}>{t(`notifPrefs.cat.${cat}`)}</Text>
                                <Text style={styles.rowSub}>{t(`notifPrefs.catHint.${cat}`)}</Text>
                            </View>
                            <Switch
                                value={prefs.categories[cat]}
                                onValueChange={(v) => save({ categories: { ...prefs.categories, [cat]: v } })}
                                trackColor={{ true: theme.accent }}
                                thumbColor="#fff"
                                accessibilityLabel={t(`notifPrefs.cat.${cat}`)}
                            />
                        </View>
                    ))}
                </View>

                <Text style={styles.footer}>{t('notifPrefs.footer')}</Text>
            </ScrollView>
        </SafeAreaView>
    );
}

const CAT_ICON: Record<string, string> = {
    handoff: 'hand-right-outline',
    messages: 'chatbubble-outline',
    sla: 'timer-outline',
    appointments: 'calendar-outline',
};

const styles = StyleSheet.create({
    section: { color: theme.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
    card: { backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 2 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
    rowLabel: { color: theme.text, fontSize: 14, fontWeight: '600' },
    rowSub: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
    hint: { color: theme.textSecondary, fontSize: 12, marginTop: 6 },
    fixBtn: { backgroundColor: theme.accent + '22', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    fixBtnText: { color: theme.accent, fontSize: 13, fontWeight: '600' },
    timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 12 },
    timeField: { flex: 1 },
    timeLabel: { color: theme.textSecondary, fontSize: 12, marginBottom: 4 },
    timeInput: {
        backgroundColor: theme.bg, color: theme.text, borderColor: theme.border, borderWidth: 1,
        borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16,
        fontWeight: '600', textAlign: 'center',
    },
    footer: { color: theme.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 24, marginBottom: 8 },
});
