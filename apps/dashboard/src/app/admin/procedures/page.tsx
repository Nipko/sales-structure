"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Workflow, Plus, Sparkles, Loader2, Trash2, Play, Pause, X,
    MessageSquare, HelpCircle, Wrench, GitBranch, Headset,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

type StepType = "message" | "ask" | "tool" | "condition" | "handoff";

interface Step {
    id: string;
    type: StepType;
    config: Record<string, any>;
    next?: string;
}

interface Procedure {
    id: string;
    name: string;
    description?: string;
    trigger: { keywords: string[]; description?: string };
    steps: Step[];
    status: "draft" | "active" | "inactive";
    vertical?: string;
    version: number;
    sourceSop?: string;
}

const STEP_META: Record<StepType, { icon: any; color: string }> = {
    message: { icon: MessageSquare, color: "text-sky-500" },
    ask: { icon: HelpCircle, color: "text-amber-500" },
    tool: { icon: Wrench, color: "text-violet-500" },
    condition: { icon: GitBranch, color: "text-emerald-500" },
    handoff: { icon: Headset, color: "text-rose-500" },
};

const STATUS_STYLE: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    draft: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    inactive: "bg-neutral-100 text-neutral-500 dark:bg-white/[0.06] dark:text-neutral-400",
};

const CARD = "rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08]";

export default function ProceduresPage() {
    const t = useTranslations("procedures");
    const { activeTenantId } = useTenant();

    const [procedures, setProcedures] = useState<Procedure[]>([]);
    const [selected, setSelected] = useState<Procedure | null>(null);
    const [loading, setLoading] = useState(false);
    const [compiling, setCompiling] = useState(false);
    const [saving, setSaving] = useState(false);
    const [sop, setSop] = useState("");
    const [showCompose, setShowCompose] = useState(false);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        const res: any = await api.listProcedures(activeTenantId);
        if (res?.success) setProcedures(res.data as Procedure[]);
        setLoading(false);
    }, [activeTenantId]);

    useEffect(() => { load(); }, [load]);

    const compile = async () => {
        if (!activeTenantId || !sop.trim()) return;
        setCompiling(true);
        try {
            const res: any = await api.compileProcedure(activeTenantId, { sop });
            if (res?.success && res.data) {
                setSop("");
                setShowCompose(false);
                await load();
                setSelected(res.data as Procedure);
            }
        } finally {
            setCompiling(false);
        }
    };

    const createBlank = async () => {
        if (!activeTenantId) return;
        const res: any = await api.createProcedure(activeTenantId, {
            name: t("untitled"),
            trigger: { keywords: [] },
            steps: [{ id: "s1", type: "message", config: { text: "" } }],
            status: "draft",
        });
        if (res?.success) { await load(); setSelected(res.data as Procedure); }
    };

    const save = async (proc: Procedure) => {
        if (!activeTenantId) return;
        setSaving(true);
        try {
            const res: any = await api.updateProcedure(activeTenantId, proc.id, {
                name: proc.name,
                description: proc.description,
                trigger: proc.trigger,
                steps: proc.steps,
                vertical: proc.vertical,
            });
            if (res?.success) { setSelected(res.data as Procedure); await load(); }
        } finally {
            setSaving(false);
        }
    };

    const toggleStatus = async (proc: Procedure) => {
        if (!activeTenantId) return;
        const next = proc.status === "active" ? "inactive" : "active";
        const res: any = await api.setProcedureStatus(activeTenantId, proc.id, next);
        if (res?.success) { setSelected(res.data as Procedure); await load(); }
    };

    const remove = async (proc: Procedure) => {
        if (!activeTenantId) return;
        await api.deleteProcedure(activeTenantId, proc.id);
        if (selected?.id === proc.id) setSelected(null);
        await load();
    };

    return (
        <div className="space-y-6">
            <PageHeader
                icon={Workflow}
                title={t("title")}
                subtitle={t("subtitle")}
                action={
                    <div className="flex gap-2">
                        <button onClick={() => setShowCompose(true)} className="flex items-center gap-2 rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:opacity-90">
                            <Sparkles size={16} /> {t("writeSop")}
                        </button>
                        <button onClick={createBlank} className="flex items-center gap-2 rounded-lg border border-neutral-200 dark:border-white/10 px-4 py-2 text-sm font-medium text-foreground hover:bg-neutral-50 dark:hover:bg-white/[0.04]">
                            <Plus size={16} /> {t("blank")}
                        </button>
                    </div>
                }
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* List */}
                <div className={cn(CARD, "lg:col-span-1 p-4 h-fit")}>
                    <h3 className="text-sm font-semibold text-foreground mb-3">{t("yourProcedures")}</h3>
                    {loading ? (
                        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" size={20} /></div>
                    ) : procedures.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-6 text-center">{t("empty")}</p>
                    ) : (
                        <div className="space-y-1.5">
                            {procedures.map((p) => (
                                <button
                                    key={p.id}
                                    onClick={() => setSelected(p)}
                                    className={cn(
                                        "w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-white/[0.04]",
                                        selected?.id === p.id && "bg-neutral-50 dark:bg-white/[0.04]",
                                    )}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-foreground truncate">{p.name}</div>
                                        <div className="text-[11px] text-muted-foreground">{p.steps.length} {t("steps")} · v{p.version}</div>
                                    </div>
                                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", STATUS_STYLE[p.status])}>{t(`status_${p.status}`)}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Editor */}
                <div className="lg:col-span-2">
                    {selected ? (
                        <ProcedureEditor
                            key={selected.id}
                            procedure={selected}
                            onSave={save}
                            onToggleStatus={toggleStatus}
                            onDelete={remove}
                            saving={saving}
                            t={t}
                        />
                    ) : (
                        <div className={cn(CARD, "flex flex-col items-center justify-center py-20 text-center")}>
                            <Workflow size={32} className="text-muted-foreground mb-3" />
                            <p className="text-sm text-text-secondary">{t("selectOrCreate")}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Compose SOP modal */}
            {showCompose && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowCompose(false)}>
                    <div className={cn(CARD, "w-full max-w-xl p-6")} onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-base font-semibold text-foreground flex items-center gap-2"><Sparkles size={18} className="text-accent" /> {t("writeSop")}</h3>
                            <button onClick={() => setShowCompose(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">{t("sopHint")}</p>
                        <textarea
                            value={sop}
                            onChange={(e) => setSop(e.target.value)}
                            rows={7}
                            placeholder={t("sopPlaceholder")}
                            className="w-full rounded-lg bg-neutral-50 dark:bg-white/[0.04] border border-neutral-200 dark:border-white/10 px-3 py-2 text-sm text-foreground resize-none"
                        />
                        <button
                            onClick={compile}
                            disabled={compiling || !sop.trim()}
                            className="mt-4 w-full flex items-center justify-center gap-2 rounded-lg bg-accent text-white px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                        >
                            {compiling ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                            {t("compile")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Editor ───────────────────────────────────────────────────
function ProcedureEditor({ procedure, onSave, onToggleStatus, onDelete, saving, t }: {
    procedure: Procedure;
    onSave: (p: Procedure) => void;
    onToggleStatus: (p: Procedure) => void;
    onDelete: (p: Procedure) => void;
    saving: boolean;
    t: ReturnType<typeof useTranslations>;
}) {
    const [draft, setDraft] = useState<Procedure>(procedure);

    const update = (patch: Partial<Procedure>) => setDraft((d) => ({ ...d, ...patch }));
    const updateStep = (idx: number, patch: Partial<Step>) =>
        setDraft((d) => ({ ...d, steps: d.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)) }));
    const updateStepConfig = (idx: number, key: string, value: any) =>
        setDraft((d) => ({ ...d, steps: d.steps.map((s, i) => (i === idx ? { ...s, config: { ...s.config, [key]: value } } : s)) }));
    const addStep = () =>
        setDraft((d) => ({ ...d, steps: [...d.steps, { id: `s${d.steps.length + 1}_${Date.now().toString(36).slice(-3)}`, type: "message", config: { text: "" } }] }));
    const removeStep = (idx: number) => setDraft((d) => ({ ...d, steps: d.steps.filter((_, i) => i !== idx) }));
    const moveStep = (idx: number, dir: -1 | 1) =>
        setDraft((d) => {
            const j = idx + dir;
            if (j < 0 || j >= d.steps.length) return d;
            const steps = [...d.steps];
            [steps[idx], steps[j]] = [steps[j], steps[idx]];
            return { ...d, steps };
        });

    return (
        <div className={cn(CARD, "p-6 space-y-5")}>
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                    <input
                        value={draft.name}
                        onChange={(e) => update({ name: e.target.value })}
                        className="w-full bg-transparent text-lg font-semibold text-foreground outline-none border-b border-transparent focus:border-neutral-300 dark:focus:border-white/20"
                    />
                    <input
                        value={draft.description || ""}
                        onChange={(e) => update({ description: e.target.value })}
                        placeholder={t("descriptionPlaceholder")}
                        className="w-full bg-transparent text-sm text-muted-foreground outline-none mt-1"
                    />
                </div>
                <span className={cn("text-[11px] px-2 py-1 rounded-full font-medium shrink-0", STATUS_STYLE[draft.status])}>{t(`status_${draft.status}`)} · v{draft.version}</span>
            </div>

            {/* Trigger keywords */}
            <div>
                <label className="text-xs font-medium text-text-secondary">{t("triggerKeywords")}</label>
                <input
                    value={(draft.trigger?.keywords || []).join(", ")}
                    onChange={(e) => update({ trigger: { ...draft.trigger, keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) } })}
                    placeholder={t("triggerPlaceholder")}
                    className="mt-1.5 w-full rounded-lg bg-neutral-50 dark:bg-white/[0.04] border border-neutral-200 dark:border-white/10 px-3 py-2 text-sm text-foreground"
                />
                <p className="text-[11px] text-muted-foreground mt-1">{t("triggerHint")}</p>
            </div>

            {/* Steps */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-text-secondary">{t("steps")}</label>
                    <button onClick={addStep} className="text-xs font-medium text-accent flex items-center gap-1 hover:underline"><Plus size={13} /> {t("addStep")}</button>
                </div>
                {draft.steps.map((step, idx) => {
                    const Meta = STEP_META[step.type] || STEP_META.message;
                    const Icon = Meta.icon;
                    return (
                        <div key={step.id} className="rounded-lg border border-neutral-200 dark:border-white/10 p-3">
                            <div className="flex items-center gap-2 mb-2">
                                <div className="flex flex-col">
                                    <button onClick={() => moveStep(idx, -1)} className="text-muted-foreground hover:text-foreground leading-none">▲</button>
                                    <button onClick={() => moveStep(idx, 1)} className="text-muted-foreground hover:text-foreground leading-none">▼</button>
                                </div>
                                <Icon size={15} className={Meta.color} />
                                <span className="text-[11px] font-mono text-muted-foreground">{step.id}</span>
                                <select
                                    value={step.type}
                                    onChange={(e) => updateStep(idx, { type: e.target.value as StepType })}
                                    className="text-xs rounded-md bg-neutral-50 dark:bg-white/[0.04] border border-neutral-200 dark:border-white/10 px-2 py-1 text-foreground"
                                >
                                    {(["message", "ask", "tool", "condition", "handoff"] as StepType[]).map((tp) => (
                                        <option key={tp} value={tp}>{t(`step_${tp}`)}</option>
                                    ))}
                                </select>
                                <button onClick={() => removeStep(idx)} className="ml-auto text-muted-foreground hover:text-red-400"><Trash2 size={14} /></button>
                            </div>
                            <StepConfig step={step} idx={idx} updateStepConfig={updateStepConfig} t={t} />
                        </div>
                    );
                })}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-neutral-100 dark:border-white/10">
                <button onClick={() => onSave(draft)} disabled={saving} className="flex items-center gap-2 rounded-lg bg-accent text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                    {saving ? <Loader2 size={15} className="animate-spin" /> : null} {t("save")}
                </button>
                <button onClick={() => onToggleStatus(draft)} className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border", draft.status === "active" ? "border-amber-300 text-amber-600 dark:border-amber-500/40 dark:text-amber-400" : "border-emerald-300 text-emerald-600 dark:border-emerald-500/40 dark:text-emerald-400")}>
                    {draft.status === "active" ? <><Pause size={15} /> {t("deactivate")}</> : <><Play size={15} /> {t("activate")}</>}
                </button>
                <button onClick={() => onDelete(draft)} className="ml-auto flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-red-400">
                    <Trash2 size={15} />
                </button>
            </div>
        </div>
    );
}

function StepConfig({ step, idx, updateStepConfig, t }: {
    step: Step; idx: number;
    updateStepConfig: (idx: number, key: string, value: any) => void;
    t: ReturnType<typeof useTranslations>;
}) {
    const c = step.config || {};
    const inputCls = "w-full rounded-md bg-neutral-50 dark:bg-white/[0.04] border border-neutral-200 dark:border-white/10 px-2.5 py-1.5 text-sm text-foreground";

    if (step.type === "message") {
        return <textarea value={c.text || ""} onChange={(e) => updateStepConfig(idx, "text", e.target.value)} rows={2} placeholder={t("cfg_message")} className={cn(inputCls, "resize-none")} />;
    }
    if (step.type === "ask") {
        return (
            <div className="grid grid-cols-2 gap-2">
                <input value={c.field || ""} onChange={(e) => updateStepConfig(idx, "field", e.target.value)} placeholder={t("cfg_field")} className={inputCls} />
                <input value={c.question || ""} onChange={(e) => updateStepConfig(idx, "question", e.target.value)} placeholder={t("cfg_question")} className={inputCls} />
            </div>
        );
    }
    if (step.type === "tool") {
        return (
            <div className="grid grid-cols-2 gap-2">
                <input value={c.tool || ""} onChange={(e) => updateStepConfig(idx, "tool", e.target.value)} placeholder={t("cfg_tool")} className={inputCls} />
                <input value={c.saveAs || ""} onChange={(e) => updateStepConfig(idx, "saveAs", e.target.value)} placeholder={t("cfg_saveAs")} className={inputCls} />
            </div>
        );
    }
    if (step.type === "condition") {
        return (
            <div className="grid grid-cols-2 gap-2">
                <input value={c.conditionField || ""} onChange={(e) => updateStepConfig(idx, "conditionField", e.target.value)} placeholder={t("cfg_conditionField")} className={inputCls} />
                <select value={c.operator || "exists"} onChange={(e) => updateStepConfig(idx, "operator", e.target.value)} className={inputCls}>
                    {["eq", "neq", "contains", "exists", "not_exists"].map((op) => <option key={op} value={op}>{op}</option>)}
                </select>
                <input value={c.value || ""} onChange={(e) => updateStepConfig(idx, "value", e.target.value)} placeholder={t("cfg_value")} className={inputCls} />
                <div className="grid grid-cols-2 gap-2">
                    <input value={c.then || ""} onChange={(e) => updateStepConfig(idx, "then", e.target.value)} placeholder={t("cfg_then")} className={inputCls} />
                    <input value={c.else || ""} onChange={(e) => updateStepConfig(idx, "else", e.target.value)} placeholder={t("cfg_else")} className={inputCls} />
                </div>
            </div>
        );
    }
    if (step.type === "handoff") {
        return <input value={c.reason || ""} onChange={(e) => updateStepConfig(idx, "reason", e.target.value)} placeholder={t("cfg_reason")} className={inputCls} />;
    }
    return null;
}
