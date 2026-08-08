"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import {
    GripVertical, Plus, Trash2, Save, Loader2, Settings, Eye, EyeOff, X, Sparkles, RefreshCw,
} from "lucide-react";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { UpgradeBanner } from "@/components/ui/upgrade-banner";
import { HelpPanel } from "@/components/ui/help-panel";

interface PipelineStage {
    id?: string;
    name: string;
    slug: string;
    color: string;
    position: number;
    default_probability: number;
    sla_hours: number | null;
    is_terminal: boolean;
    terminal_outcome: 'won' | 'lost' | null;
    transition_rules?: any[];
}

const DEFAULT_STAGES: PipelineStage[] = [
    { name: 'Nuevo', slug: 'nuevo', color: '#95a5a6', position: 0, default_probability: 10, sla_hours: null, is_terminal: false, terminal_outcome: null, transition_rules: [] },
    { name: 'Contactado', slug: 'contactado', color: '#3498db', position: 1, default_probability: 20, sla_hours: null, is_terminal: false, terminal_outcome: null, transition_rules: [] },
    { name: 'Respondió', slug: 'respondio', color: '#9b59b6', position: 2, default_probability: 30, sla_hours: null, is_terminal: false, terminal_outcome: null, transition_rules: [] },
    { name: 'Calificado', slug: 'calificado', color: '#e67e22', position: 3, default_probability: 50, sla_hours: null, is_terminal: false, terminal_outcome: null, transition_rules: [] },
    { name: 'Tibio', slug: 'tibio', color: '#f39c12', position: 4, default_probability: 60, sla_hours: null, is_terminal: false, terminal_outcome: null, transition_rules: [] },
    { name: 'Caliente', slug: 'caliente', color: '#e74c3c', position: 5, default_probability: 80, sla_hours: null, is_terminal: false, terminal_outcome: null, transition_rules: [] },
    { name: 'Listo para cierre', slug: 'listo_para_cierre', color: '#27ae60', position: 6, default_probability: 95, sla_hours: null, is_terminal: false, terminal_outcome: null, transition_rules: [] },
    { name: 'Ganado', slug: 'ganado', color: '#2ecc71', position: 7, default_probability: 100, sla_hours: null, is_terminal: true, terminal_outcome: 'won', transition_rules: [] },
    { name: 'Perdido', slug: 'perdido', color: '#7f8c8d', position: 8, default_probability: 0, sla_hours: null, is_terminal: true, terminal_outcome: 'lost', transition_rules: [] },
    { name: 'No interesado', slug: 'no_interesado', color: '#bdc3c7', position: 9, default_probability: 0, sla_hours: null, is_terminal: true, terminal_outcome: 'lost', transition_rules: [] },
];

export default function PipelineSettingsPage() {
    const t = useTranslations("pipelineSettings");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const { activeTenantId } = useTenant();
    const { canCreate, getLimit } = usePlanLimits();

    const locale = useLocale();
    const [stages, setStages] = useState<PipelineStage[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const [expandedStageIdx, setExpandedStageIdx] = useState<number | null>(null);
    const [loadingPresets, setLoadingPresets] = useState(false);
    const [autoProgress, setAutoProgress] = useState(true);
    const [savingAuto, setSavingAuto] = useState(false);
    const [resyncing, setResyncing] = useState(false);
    const [resyncMsg, setResyncMsg] = useState<string | null>(null);
    const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleLoadPresets = async () => {
        if (!activeTenantId) return;
        if (!confirm(t("loadPresetConfirm"))) return;
        setLoadingPresets(true);
        try {
            const res = await api.fetch(`/verticals/${activeTenantId}/stages-presets`);
            const presets = res?.data || [];
            if (presets.length > 0) {
                const mappedStages = presets.map((p: any, i: number) => ({
                    name: p.name[locale] || p.name['es'] || p.slug,
                    slug: p.slug,
                    color: p.color,
                    position: i,
                    default_probability: p.probability,
                    sla_hours: p.slaHours || null,
                    is_terminal: p.isTerminal,
                    terminal_outcome: p.isTerminal ? (p.terminalOutcome || null) : null,
                    transition_rules: p.transitionRules || [],
                }));
                setStages(mappedStages);
                setDirty(true);
                alert(t("loadPresetSuccess"));
            } else {
                alert(t("noPresetsFound"));
            }
        } catch (err) {
            console.error('Failed to load stages presets:', err);
        } finally {
            setLoadingPresets(false);
        }
    };

    useEffect(() => {
        if (!activeTenantId) return;
        setLoading(true);
        api.fetch(`/crm/pipeline-stages/${activeTenantId}`)
            .then((res: any) => {
                const data = res?.data || [];
                if (data.length > 0) {
                    setStages(data.map((s: any, i: number) => ({
                        ...s,
                        slug: s.slug === 'listo_cierre' ? 'listo_para_cierre' : s.slug,
                        position: s.position ?? i,
                        terminal_outcome: s.is_terminal ? (s.terminal_outcome || null) : null,
                    })));
                } else {
                    setStages(DEFAULT_STAGES);
                }
            })
            .catch(() => setStages(DEFAULT_STAGES))
            .finally(() => setLoading(false));
    }, [activeTenantId]);

    useEffect(() => {
        if (!activeTenantId) return;
        api.getAutoProgress(activeTenantId)
            .then((res: any) => { if (res?.success && res.data) setAutoProgress(res.data.enabled !== false); })
            .catch(() => { /* default ON */ });
    }, [activeTenantId]);

    async function toggleAuto(val: boolean) {
        if (!activeTenantId) return;
        setAutoProgress(val);
        setSavingAuto(true);
        try { await api.setAutoProgress(activeTenantId, val); }
        catch { setAutoProgress(!val); }
        finally { setSavingAuto(false); }
    }

    async function resync() {
        if (!activeTenantId) return;
        setResyncing(true); setResyncMsg(null);
        try {
            const res: any = await api.resyncDeals(activeTenantId);
            if (res?.success) setResyncMsg(t("resyncDone", { count: res.data?.synced ?? 0 }));
        } catch { /* ignore */ }
        finally { setResyncing(false); }
    }

    const handleSave = async () => {
        if (!activeTenantId) return;
        const ambiguous = stages.find((stage) => stage.is_terminal && !stage.terminal_outcome);
        if (ambiguous) {
            setSaveMsg({ type: 'error', text: t('terminalOutcomeRequired', { stage: ambiguous.name || t('stageName') }) });
            return;
        }
        setSaving(true);
        setSaveMsg(null);
        try {
            const response = await api.fetch(`/crm/pipeline-stages/${activeTenantId}/bulk`, {
                method: 'PUT',
                body: JSON.stringify({
                    stages: stages.map((stage, position) => ({ ...stage, position })),
                }),
            });
            const saved = response?.data || [];
            setStages(saved.map((stage: any, position: number) => ({ ...stage, position })));
            setDirty(false);
            setSaveMsg({ type: 'success', text: t('saveSuccess') });
        } catch (err) {
            console.error('Failed to save pipeline stages:', err);
            setSaveMsg({ type: 'error', text: t('saveError') });
        } finally {
            setSaving(false);
        }
    };

    const addStage = () => {
        const newPos = stages.length;
        setStages([...stages, {
            name: '',
            slug: '',
            color: '#3498db',
            position: newPos,
            default_probability: 0,
            sla_hours: null,
            is_terminal: false,
            terminal_outcome: null,
            transition_rules: [],
        }]);
        setDirty(true);
    };

    const removeStage = (idx: number) => {
        setStages(stages.filter((_, i) => i !== idx));
        setDirty(true);
    };

    const updateStage = (idx: number, field: string, value: any) => {
        setStages(stages.map((s, i) => {
            if (i !== idx) return s;
            const updated = { ...s, [field]: value };
            if (field === 'is_terminal') updated.terminal_outcome = value ? null : null;
            if (field === 'name' && !s.id) {
                updated.slug = value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            }
            return updated;
        }));
        setDirty(true);
    };

    const handleDrop = (dropIdx: number) => {
        if (dragIdx === null || dragIdx === dropIdx) return;
        const reordered = [...stages];
        const [moved] = reordered.splice(dragIdx, 1);
        reordered.splice(dropIdx, 0, moved);
        setStages(reordered);
        setDragIdx(null);
        setDirty(true);
    };

    if (loading) {
        return (
            <div className="max-w-[800px] mx-auto space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="skeleton h-14 w-full rounded-xl" />
                ))}
            </div>
        );
    }

    return (
        <div className="max-w-[800px] mx-auto pb-20">
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={Settings}
            />

            <HelpPanel
                title={tHelp("settingsPipeline.title")}
                description={tHelp("settingsPipeline.description")}
                tips={tHelp.raw("settingsPipeline.tips") as string[]}
                mediaKey="settingsPipeline"
            />

            <UpgradeBanner current={stages.length} limit={getLimit("pipelineStages")} resourceLabel={t("resourceLabel")} />

            {/* Auto-progression toggle */}
            <div className="bg-card border border-border rounded-xl p-4 mb-4 flex items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-semibold">{t("autoProgressTitle")}</div>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("autoProgressHint")}</p>
                    <div className="mt-2 flex items-center gap-2">
                        <button
                            onClick={resync}
                            disabled={resyncing}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                        >
                            {resyncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                            {t("resyncBtn")}
                        </button>
                        {resyncMsg && <span className="text-xs text-emerald-600 dark:text-emerald-400">{resyncMsg}</span>}
                    </div>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={autoProgress}
                    disabled={savingAuto}
                    onClick={() => toggleAuto(!autoProgress)}
                    className={cn(
                        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
                        autoProgress ? "bg-indigo-600" : "bg-neutral-300 dark:bg-neutral-700",
                    )}
                >
                    <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform", autoProgress ? "translate-x-6" : "translate-x-1")} />
                </button>
            </div>

            {/* Industry Preset Trigger Bar */}
            <div className="flex justify-end mb-4">
                <button
                    onClick={handleLoadPresets}
                    disabled={loadingPresets}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-xs font-semibold shadow-sm backdrop-blur-md cursor-pointer transition-all duration-200 disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
                >
                    {loadingPresets ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    {t("loadPresetBtn")}
                </button>
            </div>

             <div className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Header row */}
                <div className="grid grid-cols-[40px_1fr_80px_100px_80px_40px_40px] gap-2 px-4 py-3 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <div></div>
                    <div>{t("name")}</div>
                    <div>{t("color")}</div>
                    <div>{t("probability")}</div>
                    <div>{t("terminal")}</div>
                    <div>{t("rulesHeader")}</div>
                    <div></div>
                </div>
 
                {/* Stage rows */}
                {stages.map((stage, idx) => (
                    <div key={idx} className="border-b border-border">
                        <div
                            draggable
                            onDragStart={() => setDragIdx(idx)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => handleDrop(idx)}
                            className={cn(
                                "grid grid-cols-[40px_1fr_80px_100px_80px_40px_40px] gap-2 px-4 py-2.5 items-center transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40",
                                dragIdx === idx && "opacity-50 bg-indigo-50 dark:bg-indigo-500/10",
                                expandedStageIdx === idx && "bg-neutral-50 dark:bg-neutral-800/30"
                            )}
                        >
                            <div className="cursor-grab text-muted-foreground"><GripVertical size={16} /></div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: stage.color }} />
                                <input
                                    type="text"
                                    value={stage.name}
                                    onChange={(e) => updateStage(idx, 'name', e.target.value)}
                                    placeholder={t("stageName")}
                                    className="w-full px-2 py-1.5 rounded-lg border border-border bg-transparent text-sm outline-none focus:border-indigo-500/50"
                                />
                            </div>
                            <input
                                type="color"
                                value={stage.color}
                                onChange={(e) => updateStage(idx, 'color', e.target.value)}
                                className="w-8 h-8 rounded cursor-pointer border-none"
                            />
                            <div className="flex items-center gap-1">
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={stage.default_probability}
                                    onChange={(e) => updateStage(idx, 'default_probability', Number(e.target.value))}
                                    className="w-16 px-2 py-1.5 rounded-lg border border-border bg-transparent text-sm outline-none text-center"
                                />
                                <span className="text-xs text-muted-foreground">%</span>
                            </div>
                            <div className="flex flex-col items-center justify-center gap-1">
                                <button
                                    onClick={() => updateStage(idx, 'is_terminal', !stage.is_terminal)}
                                    className={cn(
                                        "p-1.5 rounded-lg border-none cursor-pointer transition-colors bg-transparent",
                                        stage.is_terminal
                                            ? "text-red-500 hover:bg-red-500/10"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                    title={stage.is_terminal ? t("terminalYes") : t("terminalNo")}
                                >
                                    {stage.is_terminal ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                                {stage.is_terminal && (
                                    <select
                                        aria-label={t("terminalOutcome")}
                                        value={stage.terminal_outcome || ''}
                                        onChange={(e) => updateStage(idx, 'terminal_outcome', e.target.value || null)}
                                        className="w-[76px] rounded border border-border bg-background px-1 py-0.5 text-[10px] outline-none focus:border-indigo-500/50"
                                    >
                                        <option value="">{t("outcomePlaceholder")}</option>
                                        <option value="won">{t("outcomeWon")}</option>
                                        <option value="lost">{t("outcomeLost")}</option>
                                    </select>
                                )}
                            </div>
                            <div className="flex justify-center">
                                <button
                                    onClick={() => setExpandedStageIdx(expandedStageIdx === idx ? null : idx)}
                                    className={cn(
                                        "p-1.5 rounded-lg border-none cursor-pointer transition-colors bg-transparent",
                                        (stage.transition_rules?.length || 0) > 0 || expandedStageIdx === idx
                                            ? "text-indigo-500 hover:bg-indigo-500/10"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                    title={t("transitionRulesTitle")}
                                >
                                    <Settings size={14} />
                                </button>
                            </div>
                            <button
                                onClick={() => removeStage(idx)}
                                className="p-1.5 rounded-lg border-none bg-transparent text-muted-foreground hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>

                        {/* Transition Rules Accordion Panel */}
                        {expandedStageIdx === idx && (
                            <div className="px-12 py-4 bg-neutral-50/50 dark:bg-neutral-900/35 border-t border-b border-border/60">
                                <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                                    ⚙️ {t("transitionRulesTitle")} - "{stage.name || 'Etapa'}"
                                </h4>
                                <p className="text-[11px] text-muted-foreground mb-4">
                                    {t("transitionRulesDesc")}
                                </p>

                                {/* Active Rules List */}
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {(!stage.transition_rules || stage.transition_rules.length === 0) ? (
                                        <span className="text-xs text-muted-foreground italic">{t("noRules")}</span>
                                    ) : (
                                        stage.transition_rules.map((rule, ruleIdx) => {
                                            let label = '';
                                            switch (rule.type) {
                                                case 'min_score':
                                                    label = `${t('rule_min_score')}: ${rule.value}/10`;
                                                    break;
                                                case 'custom_attribute_required':
                                                    label = `${t('rule_custom_attribute_required')}: ${rule.field}`;
                                                    break;
                                                case 'custom_attribute_equals':
                                                    label = `${t('rule_custom_attribute_equals').replace('...', '')} '${rule.field}' = '${rule.value}'`;
                                                    break;
                                                default:
                                                    label = t(`rule_${rule.type}`);
                                                    break;
                                            }
                                            return (
                                                <div key={ruleIdx} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs font-medium text-indigo-500">
                                                    {label}
                                                    <button
                                                        onClick={() => {
                                                            const updatedRules = (stage.transition_rules || []).filter((_, rId) => rId !== ruleIdx);
                                                            updateStage(idx, 'transition_rules', updatedRules);
                                                        }}
                                                        className="p-px bg-transparent border-none text-indigo-500 hover:text-red-500 cursor-pointer"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>

                                {/* Add Rule Form */}
                                <div className="flex items-end gap-3 p-3 rounded-lg border border-border bg-card/60 backdrop-blur-sm max-w-[640px]">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] font-semibold text-muted-foreground uppercase">{t("ruleTypeLabel")}</label>
                                        <select
                                            id={`rule-type-${idx}`}
                                            className="px-2 py-1.5 rounded-lg border border-border bg-background text-xs outline-none focus:border-indigo-500/50 min-w-[200px]"
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                const scoreDiv = document.getElementById(`rule-score-div-${idx}`);
                                                const fieldDiv = document.getElementById(`rule-field-div-${idx}`);
                                                const valDiv = document.getElementById(`rule-val-div-${idx}`);
                                                if (scoreDiv) scoreDiv.style.display = val === 'min_score' ? 'flex' : 'none';
                                                if (fieldDiv) fieldDiv.style.display = ['custom_attribute_required', 'custom_attribute_equals'].includes(val) ? 'flex' : 'none';
                                                if (valDiv) valDiv.style.display = val === 'custom_attribute_equals' ? 'flex' : 'none';
                                            }}
                                        >
                                            <option value="email_required">{t("rule_email_required")}</option>
                                            <option value="phone_required">{t("rule_phone_required")}</option>
                                            <option value="name_required">{t("rule_name_required")}</option>
                                            <option value="min_score">{t("rule_min_score")}</option>
                                            <option value="agent_assigned">{t("rule_agent_assigned")}</option>
                                            <option value="appointment_required">{t("rule_appointment_required")}</option>
                                            <option value="offer_required">{t("rule_offer_required")}</option>
                                            <option value="custom_attribute_required">{t("rule_custom_attribute_required")}</option>
                                            <option value="custom_attribute_equals">{t("rule_custom_attribute_equals")}</option>
                                        </select>
                                    </div>

                                    <div id={`rule-score-div-${idx}`} className="flex flex-col gap-1" style={{ display: 'none' }}>
                                        <label className="text-[10px] font-semibold text-muted-foreground uppercase">{t("minScoreLabel")}</label>
                                        <input
                                            id={`rule-score-${idx}`}
                                            type="number"
                                            min={1}
                                            max={10}
                                            defaultValue={5}
                                            className="w-16 px-2 py-1.5 rounded-lg border border-border bg-background text-xs outline-none text-center"
                                        />
                                    </div>

                                    <div id={`rule-field-div-${idx}`} className="flex flex-col gap-1" style={{ display: 'none' }}>
                                        <label className="text-[10px] font-semibold text-muted-foreground uppercase">{t("fieldKeyLabel")}</label>
                                        <input
                                            id={`rule-field-${idx}`}
                                            type="text"
                                            placeholder={t("fieldKeyPlaceholder")}
                                            className="px-2 py-1.5 rounded-lg border border-border bg-background text-xs outline-none w-28"
                                        />
                                    </div>

                                    <div id={`rule-val-div-${idx}`} className="flex flex-col gap-1" style={{ display: 'none' }}>
                                        <label className="text-[10px] font-semibold text-muted-foreground uppercase">{t("expectedValueLabel")}</label>
                                        <input
                                            id={`rule-val-${idx}`}
                                            type="text"
                                            placeholder={t("expectedValuePlaceholder")}
                                            className="px-2 py-1.5 rounded-lg border border-border bg-background text-xs outline-none w-28"
                                        />
                                    </div>

                                    <button
                                        onClick={() => {
                                            const typeEl = document.getElementById(`rule-type-${idx}`) as HTMLSelectElement;
                                            const scoreEl = document.getElementById(`rule-score-${idx}`) as HTMLInputElement;
                                            const fieldEl = document.getElementById(`rule-field-${idx}`) as HTMLInputElement;
                                            const valEl = document.getElementById(`rule-val-${idx}`) as HTMLInputElement;

                                            const type = typeEl?.value || 'email_required';
                                            const ruleObj: any = { type };
                                            if (type === 'min_score') ruleObj.value = Number(scoreEl?.value || 5);
                                            if (['custom_attribute_required', 'custom_attribute_equals'].includes(type)) {
                                                ruleObj.field = fieldEl?.value?.trim() || '';
                                            }
                                            if (type === 'custom_attribute_equals') ruleObj.value = valEl?.value?.trim() || '';

                                            if (['custom_attribute_required', 'custom_attribute_equals'].includes(type) && !ruleObj.field) {
                                                return;
                                            }

                                            const updatedRules = [...(stage.transition_rules || []), ruleObj];
                                            updateStage(idx, 'transition_rules', updatedRules);

                                            if (fieldEl) fieldEl.value = '';
                                            if (valEl) valEl.value = '';
                                        }}
                                        className="px-4 py-2 rounded-lg border-none bg-indigo-500 text-white text-xs font-semibold hover:bg-indigo-600 transition-colors flex items-center gap-1 cursor-pointer"
                                    >
                                        <Plus size={12} /> {t("addRuleBtn")}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}

                {/* Add stage button */}
                <button
                    onClick={addStage}
                    disabled={!canCreate("pipelineStages", stages.length)}
                    className="w-full px-4 py-3 flex items-center justify-center gap-1.5 text-sm text-indigo-500 bg-transparent border-none cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Plus size={14} /> {t("addStage")}
                </button>
            </div>

            {/* Sticky save bar */}
            {dirty && (
                <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-sm px-6 py-3 flex items-center justify-end gap-3">
                    <span className={cn(
                        "text-xs mr-auto",
                        saveMsg?.type === 'error' ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                    )}>
                        {saveMsg?.text || t("unsavedChanges")}
                    </span>
                    <button
                        onClick={() => { setStages(DEFAULT_STAGES); setDirty(false); }}
                        className="px-4 py-2 rounded-lg border border-border bg-transparent text-sm text-muted-foreground cursor-pointer hover:bg-muted transition-colors"
                    >
                        {t("reset")}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-5 py-2 rounded-lg border-none bg-indigo-500 text-white text-sm font-semibold cursor-pointer flex items-center gap-1.5 hover:bg-indigo-600 disabled:opacity-50 transition-colors"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        {saving ? tc("saving") : tc("saveChanges")}
                    </button>
                </div>
            )}
            {!dirty && saveMsg && (
                <p className={cn(
                    "mt-3 text-sm",
                    saveMsg.type === 'success' ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
                )}>
                    {saveMsg.text}
                </p>
            )}
        </div>
    );
}
