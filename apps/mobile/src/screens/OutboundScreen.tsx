/**
 * OutboundScreen — Iniciar conversación WhatsApp con plantilla HSM aprobada.
 *
 * Flujo en 3 pasos:
 *  1. Teléfono / contacto: ingresa número o busca un lead existente.
 *  2. Plantilla: selecciona de la lista de templates aprobados por Meta.
 *  3. Preview + enviar: muestra un preview del template y confirma el envío.
 *
 * Por qué importa: ningún competidor de soporte (Zendesk, Crisp, Tidio, Chatwoot)
 * permite iniciar una conversación WhatsApp desde móvil. Parallly sí — diferenciador
 * directo de ventas ("cierra deals desde el teléfono").
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
    ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { useKeyboardSpace } from '../lib/useKeyboardSpace';
import { haptic } from '../lib/haptics';
import { theme } from '../theme';

// ── Types ────────────────────────────────────────────────────────────────────
interface Template {
    id: string;
    name: string;
    language: string;
    status: string;
    category: string;
    components?: any[];
}

// ── Step indicator ───────────────────────────────────────────────────────────
function StepBar({ step }: { step: 1 | 2 | 3 }) {
    const { t } = useI18n();
    const steps = [t('outbound.step1'), t('outbound.step2'), t('outbound.step3')];
    return (
        <View style={sb.wrap}>
            {steps.map((label, i) => {
                const n = i + 1;
                const done = step > n;
                const active = step === n;
                return (
                    <React.Fragment key={n}>
                        {i > 0 && <View style={[sb.line, done && { backgroundColor: theme.accent }]} />}
                        <View style={sb.stepWrap}>
                            <View style={[sb.circle, active && { backgroundColor: theme.accent }, done && { backgroundColor: theme.success }]}>
                                {done
                                    ? <Ionicons name="checkmark" size={12} color="#fff" />
                                    : <Text style={sb.num}>{n}</Text>}
                            </View>
                            <Text style={[sb.label, active && { color: theme.text }]}>{label}</Text>
                        </View>
                    </React.Fragment>
                );
            })}
        </View>
    );
}
const sb = StyleSheet.create({
    wrap: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', paddingVertical: 16, paddingHorizontal: 8 },
    stepWrap: { alignItems: 'center', width: 70 },
    circle: { width: 26, height: 26, borderRadius: 13, backgroundColor: theme.border, alignItems: 'center', justifyContent: 'center' },
    num: { color: theme.textSecondary, fontSize: 12, fontWeight: '700' },
    label: { color: theme.textSecondary, fontSize: 10, marginTop: 4, textAlign: 'center' },
    line: { flex: 1, height: 2, backgroundColor: theme.border, marginTop: 13 },
});

// ── Component ────────────────────────────────────────────────────────────────
export function OutboundScreen() {
    const { tenantId } = useAuth();
    const nav = useNavigation<any>();
    const toast = useToast();
    const { t } = useI18n();
    const kbSpace = useKeyboardSpace();

    const [step, setStep] = useState<1 | 2 | 3>(1);

    // Step 1: phone / contact
    const [phone, setPhone] = useState('');
    const [contactQuery, setContactQuery] = useState('');
    const [contacts, setContacts] = useState<any[]>([]);
    const [loadingContacts, setLoadingContacts] = useState(false);
    const [selectedContact, setSelectedContact] = useState<any>(null);

    // Step 2: template
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

    // Step 3: send
    const [sending, setSending] = useState(false);

    // ── Contact search ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!tenantId || contactQuery.length < 2) { setContacts([]); return; }
        const t0 = setTimeout(async () => {
            setLoadingContacts(true);
            try {
                const res: any = await api.searchContacts(tenantId, contactQuery);
                const leads = res?.data?.leads || res?.data || [];
                setContacts(Array.isArray(leads) ? leads.slice(0, 8) : []);
            } catch { /* noop */ } finally {
                setLoadingContacts(false);
            }
        }, 300);
        return () => clearTimeout(t0);
    }, [tenantId, contactQuery]);

    const pickContact = (c: any) => {
        haptic.tap();
        const p = c.phone || c.contact?.phone || '';
        setSelectedContact(c);
        setPhone(p);
        setContactQuery('');
        setContacts([]);
    };

    // ── Templates ───────────────────────────────────────────────────────────
    useEffect(() => {
        if (step !== 2) return;
        setLoadingTemplates(true);
        api.getWhatsappTemplates().then((res: any) => {
            const list: Template[] = Array.isArray(res?.data) ? res.data : [];
            // Only approved templates
            setTemplates(list.filter((t: Template) => t.status?.toLowerCase() === 'approved' || !t.status));
        }).catch(() => {}).finally(() => setLoadingTemplates(false));
    }, [step]);

    // ── Navigation between steps ─────────────────────────────────────────────
    const goStep2 = () => {
        const p = phone.trim().replace(/\s/g, '');
        if (!p) { toast.error(t('outbound.phoneRequired')); return; }
        haptic.tap();
        setStep(2);
    };

    const goStep3 = (tmpl: Template) => {
        haptic.tap();
        setSelectedTemplate(tmpl);
        setStep(3);
    };

    // ── Send ─────────────────────────────────────────────────────────────────
    const send = useCallback(async () => {
        if (!selectedTemplate || !phone.trim()) return;
        haptic.success();
        setSending(true);
        try {
            const res: any = await api.sendWhatsappTemplate(
                phone.trim(),
                selectedTemplate.name,
                selectedTemplate.language,
                selectedTemplate.components,
            );
            if (res?.success || res?.messageId || res?.messages) {
                toast.success(t('outbound.sent'));
                haptic.success();
                nav.goBack();
            } else {
                toast.error(res?.message || res?.error || t('outbound.sendError'));
            }
        } catch (e: any) {
            toast.error(t('outbound.sendError'));
        } finally {
            setSending(false);
        }
    }, [selectedTemplate, phone, toast, t, nav]);

    // ── Render helpers ───────────────────────────────────────────────────────
    function renderTemplateBody(tmpl: Template): string {
        const body = tmpl.components?.find((c: any) => c.type === 'BODY');
        return body?.text || tmpl.name;
    }

    // ── Step 1: Phone / Contact ──────────────────────────────────────────────
    function renderStep1() {
        return (
            <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.sectionTitle}>{t('outbound.phoneLabel')}</Text>

                {selectedContact && (
                    <View style={styles.contactChip}>
                        <Ionicons name="person-circle-outline" size={18} color={theme.accent} />
                        <Text style={styles.contactChipText} numberOfLines={1}>
                            {selectedContact.name || selectedContact.firstName || 'Contacto'}
                        </Text>
                        <TouchableOpacity onPress={() => { setSelectedContact(null); setPhone(''); }} accessibilityRole="button">
                            <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
                        </TouchableOpacity>
                    </View>
                )}

                <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder={t('outbound.phonePlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="phone-pad"
                    accessibilityLabel={t('outbound.phoneLabel')}
                />

                <Text style={[styles.sectionTitle, { marginTop: 20 }]}>{t('outbound.searchContact')}</Text>
                <TextInput
                    style={styles.input}
                    value={contactQuery}
                    onChangeText={setContactQuery}
                    placeholder={t('outbound.searchPlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    accessibilityLabel={t('outbound.searchContact')}
                />
                {loadingContacts && <ActivityIndicator color={theme.accent} style={{ marginTop: 8 }} />}
                {contacts.map((c: any) => (
                    <TouchableOpacity key={c.id} style={styles.contactRow} onPress={() => pickContact(c)} accessibilityRole="button">
                        <Ionicons name="person-outline" size={16} color={theme.textSecondary} />
                        <View style={{ marginLeft: 10, flex: 1 }}>
                            <Text style={styles.contactName}>{c.name || c.firstName || 'Lead'}</Text>
                            <Text style={styles.contactSub}>{c.phone || c.contact?.phone || ''}</Text>
                        </View>
                    </TouchableOpacity>
                ))}

                <TouchableOpacity style={[styles.btn, { marginTop: 24 }]} onPress={goStep2} accessibilityRole="button">
                    <Text style={styles.btnText}>{t('outbound.next')}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#fff" />
                </TouchableOpacity>
            </ScrollView>
        );
    }

    // ── Step 2: Template picker ──────────────────────────────────────────────
    function renderStep2() {
        return (
            <View style={{ flex: 1 }}>
                {loadingTemplates
                    ? <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }} />
                    : templates.length === 0
                        ? <Text style={styles.empty}>{t('outbound.noTemplates')}</Text>
                        : (
                            <FlatList
                                data={templates}
                                keyExtractor={(t) => t.id || t.name}
                                contentContainerStyle={{ padding: 16 }}
                                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        style={styles.templateCard}
                                        onPress={() => goStep3(item)}
                                        accessibilityRole="button"
                                        accessibilityLabel={item.name}
                                    >
                                        <View style={styles.templateHeader}>
                                            <Text style={styles.templateName}>{item.name}</Text>
                                            <View style={styles.langChip}>
                                                <Text style={styles.langText}>{item.language?.toUpperCase()}</Text>
                                            </View>
                                        </View>
                                        <Text style={styles.templateBody} numberOfLines={3}>
                                            {renderTemplateBody(item)}
                                        </Text>
                                        <Text style={styles.templateCategory}>{item.category}</Text>
                                    </TouchableOpacity>
                                )}
                            />
                        )
                }
            </View>
        );
    }

    // ── Step 3: Preview + Send ───────────────────────────────────────────────
    function renderStep3() {
        if (!selectedTemplate) return null;
        const header = selectedTemplate.components?.find((c: any) => c.type === 'HEADER');
        const body = selectedTemplate.components?.find((c: any) => c.type === 'BODY');
        const footer = selectedTemplate.components?.find((c: any) => c.type === 'FOOTER');
        const buttons = selectedTemplate.components?.find((c: any) => c.type === 'BUTTONS');

        return (
            <ScrollView contentContainerStyle={{ padding: 16 }}>
                <Text style={styles.sectionTitle}>{t('outbound.previewTitle')}</Text>
                <Text style={styles.previewMeta}>{t('outbound.to')}: {phone}</Text>

                {/* WhatsApp bubble preview */}
                <View style={styles.bubble}>
                    {header && <Text style={styles.bubbleHeader}>{header.text || ''}</Text>}
                    <Text style={styles.bubbleBody}>{body?.text || selectedTemplate.name}</Text>
                    {footer && <Text style={styles.bubbleFooter}>{footer.text}</Text>}
                    {buttons?.buttons?.map((b: any, i: number) => (
                        <View key={i} style={styles.bubbleBtn}>
                            <Text style={styles.bubbleBtnText}>{b.text}</Text>
                        </View>
                    ))}
                </View>

                <Text style={styles.previewNote}>{t('outbound.previewNote')}</Text>

                <TouchableOpacity
                    style={[styles.btn, sending && { opacity: 0.6 }, { marginTop: 24 }]}
                    onPress={send}
                    disabled={sending}
                    accessibilityRole="button"
                    accessibilityLabel={t('outbound.send')}
                >
                    {sending
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <><Ionicons name="send" size={16} color="#fff" style={{ marginRight: 6 }} /><Text style={styles.btnText}>{t('outbound.send')}</Text></>
                    }
                </TouchableOpacity>
            </ScrollView>
        );
    }

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top']}>
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={{ flex: 1, paddingBottom: kbSpace }}>
                    <StepBar step={step} />
                    {step === 1 && renderStep1()}
                    {step === 2 && renderStep2()}
                    {step === 3 && renderStep3()}
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    sectionTitle: { color: theme.text, fontSize: 14, fontWeight: '700', marginBottom: 10 },
    input: {
        backgroundColor: theme.bgCard, color: theme.text, borderColor: theme.border, borderWidth: 1,
        borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    },
    contactChip: {
        flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.accent + '18',
        borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 10, alignSelf: 'flex-start',
    },
    contactChipText: { color: theme.text, fontSize: 13, fontWeight: '600', maxWidth: 160 },
    contactRow: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bgCard,
        borderRadius: 10, padding: 12, marginTop: 6, borderWidth: 1, borderColor: theme.border,
    },
    contactName: { color: theme.text, fontSize: 14, fontWeight: '600' },
    contactSub: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
    btn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 14,
    },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    empty: { color: theme.textSecondary, textAlign: 'center', marginTop: 40, fontSize: 14 },
    templateCard: {
        backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1,
        borderRadius: 12, padding: 14,
    },
    templateHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    templateName: { color: theme.text, fontSize: 14, fontWeight: '700', flex: 1 },
    langChip: { backgroundColor: theme.accent + '22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    langText: { color: theme.accent, fontSize: 11, fontWeight: '700' },
    templateBody: { color: theme.textSecondary, fontSize: 13, lineHeight: 18 },
    templateCategory: { color: theme.textSecondary, fontSize: 11, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    previewMeta: { color: theme.textSecondary, fontSize: 13, marginBottom: 14 },
    bubble: {
        backgroundColor: '#dcf8c6', borderRadius: 12, padding: 14,
        borderTopRightRadius: 2, alignSelf: 'flex-end', maxWidth: '85%',
    },
    bubbleHeader: { color: '#000', fontSize: 14, fontWeight: '700', marginBottom: 4 },
    bubbleBody: { color: '#111', fontSize: 14, lineHeight: 20 },
    bubbleFooter: { color: '#666', fontSize: 12, marginTop: 6 },
    bubbleBtn: { borderTopWidth: 1, borderTopColor: '#aaa', marginTop: 8, paddingTop: 8 },
    bubbleBtnText: { color: '#007bff', fontSize: 13, textAlign: 'center' },
    previewNote: { color: theme.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 12 },
});
