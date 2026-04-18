"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Workflow,
    Plus,
    Pencil,
    Trash2,
    UserPlus,
    MessageSquare,
    UserCheck,
    Clock,
    Timer,
    ArrowRight,
    Activity,
    X,
    ChevronRight,
    ChevronLeft,
    Check,
    Zap,
    BarChart3,
    Shield,
} from "lucide-react";

// -- Trigger definitions --
const TRIGGERS = [
    { value: "lead.captured", icon: UserPlus, label: "Lead capturado", desc: "Cuando un nuevo lead ingresa al sistema" },
    { value: "new_message", icon: MessageSquare, label: "Mensaje nuevo", desc: "Cuando se recibe un mensaje del cliente" },
    { value: "conversation_assigned", icon: UserCheck, label: "Conversación asignada", desc: "Cuando una conversación se asigna a un agente" },
    { value: "sla_timeout", icon: Clock, label: "SLA vencido", desc: "Cuando se excede el tiempo de respuesta" },
    { value: "inactivity", icon: Timer, label: "Inactividad", desc: "Cuando el cliente no responde" },
    { value: "stage_changed", icon: ArrowRight, label: "Cambio de etapa", desc: "Cuando un lead cambia de etapa" },
];

const CONDITION_FIELDS = [
    { value: "channel", label: "Canal" },
    { value: "stage", label: "Etapa" },
    { value: "score", label: "Score" },
    { value: "tag", label: "Etiqueta" },
    { value: "source", label: "Fuente" },
    { value: "campaign_id", label: "ID de campaña" },
];

const OPERATORS = [
    { value: "equals", label: "es igual a" },
    { value: "not_equals", label: "no es igual a" },
    { value: "greater_than", label: "mayor que" },
    { value: "less_than", label: "menor que" },
    { value: "contains", label: "contiene" },
];

const ACTION_TYPES = [
    { value: "send_template", label: "Enviar plantilla WhatsApp" },
    { value: "create_task", label: "Crear tarea de seguimiento" },
    { value: "change_stage", label: "Cambiar etapa del pipeline" },
    { value: "add_tag", label: "Agregar etiqueta" },
    { value: "assign_agent", label: "Asignar a agente" },
];

const STAGES = [
    { value: "nuevo", label: "Nuevo" },
    { value: "contactado", label: "Contactado" },
    { value: "respondio", label: "Respondió" },
    { value: "calificado", label: "Calificado" },
    { value: "tibio", label: "Tibio" },
    { value: "caliente", label: "Caliente" },
    { value: "listo_para_cierre", label: "Listo para cierre" },
];

const STEP_LABELS = ["Trigger", "Condiciones", "Acciones", "Resumen"];

const emptyRuleForm = () => ({
    name: "", trigger_type: "",
    conditions: [] as { field: string; operator: string; value: string }[],
    actions: [] as { type: string; config: Record<string, any>; delay: number }[],
    active: true,
});

export default function AutomationPage() {
    const t = useTranslations('automation');
    const { activeTenantId } = useTenant();

    // -- State --
    const [rules, setRules] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<string | null>(null);

    // Wizard
    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(0);
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
    const [ruleForm, setRuleForm] = useState(emptyRuleForm());

    // Executions
    const [selectedRuleExecs, setSelectedRuleExecs] = useState<any[] | null>(null);
    const [execRuleId, setExecRuleId] = useState<string | null>(null);

    // -- Load rules --
    useEffect(() => {
        loadRules();
    }, [activeTenantId]);

    async function loadRules() {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const res = await api.getAutomationRules(activeTenantId);
            if (res.success && Array.isArray(res.data)) {
                setRules(res.data);
            }
        } catch (err) {
            console.error("Error loading rules", err);
        } finally {
            setLoading(false);
        }
    }

    // -- Toast helper --
    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(null), 2500);
    }

    // -- Toggle rule --
    async function handleToggle(id: string, currentActive: boolean) {
        const next = !currentActive;
        setRules(prev => prev.map(r => r.id === id ? { ...r, active: next } : r));
        if (activeTenantId) {
            try { await api.toggleRule(activeTenantId, id, next); } catch {}
        }
    }

    // -- Delete rule --
    async function handleDelete(id: string) {
        if (!confirm("¿Estás seguro de que deseas eliminar esta regla?")) return;
        setRules(prev => prev.filter(r => r.id !== id));
        if (activeTenantId) {
            try { await api.deleteRule(activeTenantId, id); } catch {}
        }
        showToast("Regla eliminada");
    }

    // -- Load executions --
    async function handleLoadExecs(ruleId: string) {
        if (execRuleId === ruleId) {
            setSelectedRuleExecs(null);
            setExecRuleId(null);
            return;
        }
        if (!activeTenantId) return;
        try {
            const res = await api.getRuleExecutions(activeTenantId, ruleId);
            setSelectedRuleExecs(res.success && Array.isArray(res.data) ? res.data : []);
            setExecRuleId(ruleId);
        } catch {
            setSelectedRuleExecs([]);
            setExecRuleId(ruleId);
        }
    }

    // -- Edit rule --
    function handleEdit(rule: any) {
        const conditions = Array.isArray(rule.conditions_json) ? rule.conditions_json :
            (rule.conditions_json && typeof rule.conditions_json === "object" && !Array.isArray(rule.conditions_json))
                ? Object.entries(rule.conditions_json).map(([field, value]) => ({ field, operator: "equals", value: String(value) }))
                : [];
        const actions = Array.isArray(rule.actions_json) ? rule.actions_json.map((a: any) => ({
            type: a.type || "",
            config: a.config || {},
            delay: Number(a.delay ?? 0),
        })) : [];

        setRuleForm({
            name: rule.name || "",
            trigger_type: rule.trigger_type || "",
            conditions,
            actions,
            active: rule.active ?? true,
        });
        setEditingRuleId(rule.id);
        setWizardStep(0);
        setWizardOpen(true);
    }

    // -- Save rule --
    async function handleSave() {
        if (!activeTenantId || !ruleForm.name) return;
        const payload = {
            name: ruleForm.name,
            trigger_type: ruleForm.trigger_type,
            conditions_json: ruleForm.conditions,
            actions_json: ruleForm.actions.map(a => ({ type: a.type, config: a.config, delay: a.delay })),
            active: ruleForm.active,
        };
        try {
            if (editingRuleId) {
                await api.updateRule(activeTenantId, editingRuleId, payload);
                showToast("Regla actualizada");
            } else {
                await api.createRule(activeTenantId, payload);
                showToast("Regla creada exitosamente");
            }
            setWizardOpen(false);
            setEditingRuleId(null);
            setRuleForm(emptyRuleForm());
            loadRules();
        } catch (err) {
            console.error(err);
            showToast("Error al guardar la regla");
        }
    }

    // -- Open new wizard --
    function openNewWizard() {
        setRuleForm(emptyRuleForm());
        setEditingRuleId(null);
        setWizardStep(0);
        setWizardOpen(true);
    }

    // -- Condition helpers --
    function addCondition() {
        setRuleForm(prev => ({
            ...prev,
            conditions: [...prev.conditions, { field: "channel", operator: "equals", value: "" }],
        }));
    }
    function removeCondition(idx: number) {
        setRuleForm(prev => ({ ...prev, conditions: prev.conditions.filter((_, i) => i !== idx) }));
    }
    function updateCondition(idx: number, key: string, val: string) {
        setRuleForm(prev => ({
            ...prev,
            conditions: prev.conditions.map((c, i) => i === idx ? { ...c, [key]: val } : c),
        }));
    }

    // -- Action helpers --
    function addAction() {
        setRuleForm(prev => ({
            ...prev,
            actions: [...prev.actions, { type: "send_template", config: {}, delay: 0 }],
        }));
    }
    function removeAction(idx: number) {
        setRuleForm(prev => ({ ...prev, actions: prev.actions.filter((_, i) => i !== idx) }));
    }
    function updateAction(idx: number, key: string, val: any) {
        setRuleForm(prev => ({
            ...prev,
            actions: prev.actions.map((a, i) => i === idx ? { ...a, [key]: val } : a),
        }));
    }
    function updateActionConfig(idx: number, configKey: string, val: any) {
        setRuleForm(prev => ({
            ...prev,
            actions: prev.actions.map((a, i) => i === idx ? { ...a, config: { ...a.config, [configKey]: val } } : a),
        }));
    }

    // -- Computed --
    const activeCount = rules.filter(r => r.active).length;
    const totalExecs = rules.reduce((sum, r) => sum + Number(r.execution_count || 0), 0);

    const triggerLabel = (tt: string) => TRIGGERS.find(t => t.value === tt)?.label || tt;

    // -- Can advance step? --
    const canNext = (step: number) => {
        if (step === 0) return !!ruleForm.trigger_type;
        if (step === 1) return true; // conditions optional
        if (step === 2) return ruleForm.actions.length > 0;
        return !!ruleForm.name;
    };

    // ============================
    //  RENDER: Rules List
    // ============================
    if (!wizardOpen) {
        return (
            <div className="text-foreground">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-[28px] font-semibold m-0 flex items-center gap-2.5">
                            <Workflow size={28} className="text-indigo-600" /> {t('title')}
                        </h1>
                        <p className="text-muted-foreground mt-1 mb-0 text-sm">
                            Reglas automáticas para optimizar tu operación
                        </p>
                    </div>
                    <Button onClick={openNewWizard} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
                        <Plus size={18} /> Nueva Regla
                    </Button>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3 mb-6">
                    {[
                        { label: "Total reglas", value: rules.length, icon: Shield, color: "#6c5ce7", bg: "bg-indigo-600/10" },
                        { label: "Reglas activas", value: activeCount, icon: Zap, color: "#00d68f", bg: "bg-emerald-500/10" },
                        { label: "Ejecuciones totales", value: totalExecs, icon: BarChart3, color: "#ffaa00", bg: "bg-amber-500/10" },
                    ].map(stat => {
                        const Icon = stat.icon;
                        return (
                            <Card key={stat.label} className="border-border bg-card">
                                <CardContent className="flex items-center gap-3.5 p-4">
                                    <div className={cn("w-[42px] h-[42px] rounded-[10px] flex items-center justify-center", stat.bg)}>
                                        <Icon size={20} color={stat.color} />
                                    </div>
                                    <div>
                                        <div className="text-[22px] font-semibold">{stat.value}</div>
                                        <div className="text-xs text-muted-foreground">{stat.label}</div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>

                {/* Rules list */}
                {loading ? (
                    <div className="text-center p-10 text-muted-foreground">Cargando reglas...</div>
                ) : rules.length === 0 ? (
                    <div className="text-center py-[60px] px-4 rounded-[14px] border border-dashed border-border bg-card text-muted-foreground">
                        <Workflow size={40} className="mb-3 opacity-40 mx-auto" />
                        <div className="text-base font-semibold mb-1">Sin reglas de automatización</div>
                        <div className="text-[13px]">Crea tu primera regla para empezar a automatizar</div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2.5">
                        {rules.map(rule => (
                            <div key={rule.id}>
                                <Card className={cn(
                                    "border-border bg-card transition-opacity duration-200",
                                    !rule.active && "opacity-55"
                                )}>
                                    <CardContent className="flex justify-between items-center p-4 px-5">
                                        {/* Left side */}
                                        <div className="flex items-center gap-3 flex-1">
                                            <div className={cn(
                                                "w-2.5 h-2.5 rounded-full flex-shrink-0",
                                                rule.active ? "bg-emerald-500" : "bg-neutral-400 dark:bg-neutral-600"
                                            )} />
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-[15px]">{rule.name}</span>
                                                    <Badge variant="secondary" className="bg-indigo-600/15 text-indigo-600 dark:text-indigo-400 text-[10px] px-2 py-0.5 font-semibold">
                                                        {triggerLabel(rule.trigger_type)}
                                                    </Badge>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Right side */}
                                        <div className="flex gap-2 items-center flex-shrink-0">
                                            {/* Execution count badge */}
                                            <button
                                                onClick={() => handleLoadExecs(rule.id)}
                                                className={cn(
                                                    "flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-muted-foreground text-xs cursor-pointer",
                                                    execRuleId === rule.id ? "bg-neutral-100 dark:bg-neutral-800" : "bg-transparent"
                                                )}
                                            >
                                                <Activity size={12} /> {Number(rule.execution_count || 0)}
                                            </button>

                                            {/* Toggle */}
                                            <button
                                                onClick={() => handleToggle(rule.id, rule.active)}
                                                className={cn(
                                                    "w-11 h-6 rounded-full border-none cursor-pointer relative transition-colors duration-200",
                                                    rule.active ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"
                                                )}
                                            >
                                                <div className={cn(
                                                    "w-[18px] h-[18px] rounded-full bg-white absolute top-[3px] transition-[left] duration-200 shadow-sm",
                                                    rule.active ? "left-[23px]" : "left-[3px]"
                                                )} />
                                            </button>

                                            {/* Edit */}
                                            <button
                                                onClick={() => handleEdit(rule)}
                                                className="bg-transparent border-none text-muted-foreground cursor-pointer p-1 hover:text-foreground"
                                            >
                                                <Pencil size={16} />
                                            </button>

                                            {/* Delete */}
                                            <button
                                                onClick={() => handleDelete(rule.id)}
                                                className="bg-transparent border-none text-red-500 cursor-pointer p-1 opacity-70 hover:opacity-100"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Execution history panel */}
                                {execRuleId === rule.id && selectedRuleExecs !== null && (
                                    <div className="mx-2 px-4 py-3.5 rounded-b-xl border border-border border-t-0 bg-neutral-100 dark:bg-neutral-800">
                                        <div className="flex justify-between items-center mb-2.5">
                                            <span className="text-[13px] font-semibold text-foreground">
                                                Historial de ejecuciones
                                            </span>
                                            <button
                                                onClick={() => { setSelectedRuleExecs(null); setExecRuleId(null); }}
                                                className="bg-transparent border-none text-muted-foreground cursor-pointer text-xs underline"
                                            >
                                                Cerrar
                                            </button>
                                        </div>
                                        {selectedRuleExecs.length === 0 ? (
                                            <div className="text-[13px] text-muted-foreground py-2">
                                                Sin ejecuciones registradas
                                            </div>
                                        ) : (
                                            <div className="flex flex-col gap-1.5">
                                                {selectedRuleExecs.slice(0, 10).map((exec: any, i: number) => {
                                                    const statusColor = exec.status === "success" ? "text-emerald-500"
                                                        : exec.status === "failed" ? "text-red-500" : "text-amber-500";
                                                    const dotColor = exec.status === "success" ? "bg-emerald-500"
                                                        : exec.status === "failed" ? "bg-red-500" : "bg-amber-500";
                                                    return (
                                                        <div key={exec.id || i} className="flex items-center gap-3 px-2.5 py-2 rounded-lg bg-card text-[13px]">
                                                            <div className={cn("w-2 h-2 rounded-full flex-shrink-0", dotColor)} />
                                                            <span className={cn("font-semibold min-w-[60px]", statusColor)}>
                                                                {exec.status || "queued"}
                                                            </span>
                                                            <span className="text-muted-foreground text-xs">
                                                                {exec.started_at ? new Date(exec.started_at).toLocaleString("es-CO") : "\u2014"}
                                                            </span>
                                                            <span className="text-muted-foreground text-xs">
                                                                → {exec.finished_at ? new Date(exec.finished_at).toLocaleString("es-CO") : "\u2014"}
                                                            </span>
                                                            {exec.result && (
                                                                <span className="text-muted-foreground text-[11px] ml-auto max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
                                                                    {typeof exec.result === "string" ? exec.result : JSON.stringify(exec.result).slice(0, 60)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Toast */}
                {toast && (
                    <div className={cn(
                        "fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold text-white shadow-[0_4px_20px_rgba(0,0,0,0.3)] animate-in slide-in-from-bottom-2 fade-in duration-300",
                        toast.includes("eliminada") || toast.includes("Error") ? "bg-red-500" : "bg-emerald-500"
                    )}>
                        {toast}
                    </div>
                )}
            </div>
        );
    }

    // ============================
    //  RENDER: Wizard
    // ============================
    return (
        <div className="text-foreground">
            {/* Wizard header */}
            <div className="flex items-center gap-3 mb-6">
                <button
                    onClick={() => { setWizardOpen(false); setEditingRuleId(null); setRuleForm(emptyRuleForm()); }}
                    className="bg-transparent border-none text-muted-foreground cursor-pointer text-sm"
                >
                    <ChevronLeft size={20} />
                </button>
                <h1 className="text-[22px] font-semibold m-0">
                    {editingRuleId ? "Editar Regla" : "Nueva Regla"}
                </h1>
            </div>

            {/* Step indicator */}
            <div className="flex items-center mb-8">
                {STEP_LABELS.map((label, i) => (
                    <div key={i} className={cn("flex items-center", i < STEP_LABELS.length - 1 ? "flex-1" : "flex-none")}>
                        <div
                            onClick={() => { if (i <= wizardStep) setWizardStep(i); }}
                            className={cn("flex items-center gap-2", i <= wizardStep ? "cursor-pointer" : "cursor-default")}
                        >
                            <div className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold transition-all duration-200",
                                i < wizardStep
                                    ? "bg-emerald-500 text-white"
                                    : i === wizardStep
                                        ? "bg-indigo-600 text-white"
                                        : "bg-neutral-200 dark:bg-neutral-700 text-muted-foreground"
                            )}>
                                {i < wizardStep ? <Check size={14} /> : i + 1}
                            </div>
                            <span className={cn(
                                "text-[13px] whitespace-nowrap",
                                i === wizardStep ? "font-semibold text-foreground" : "font-normal text-muted-foreground"
                            )}>
                                {label}
                            </span>
                        </div>
                        {i < STEP_LABELS.length - 1 && (
                            <div className={cn(
                                "flex-1 h-0.5 mx-3 transition-colors duration-200",
                                i < wizardStep ? "bg-emerald-500" : "bg-neutral-200 dark:bg-neutral-700"
                            )} />
                        )}
                    </div>
                ))}
            </div>

            {/* Step content */}
            <Card className="border-border bg-card min-h-[300px]">
                <CardContent className="p-6">

                    {/* -- Step 0: Trigger -- */}
                    {wizardStep === 0 && (
                        <div>
                            <h2 className="text-lg font-semibold mb-1">
                                ¿Qué evento activa esta regla?
                            </h2>
                            <p className="text-muted-foreground text-[13px] mb-5">
                                Selecciona el evento que disparará la ejecución
                            </p>
                            <div className="grid grid-cols-3 gap-3">
                                {TRIGGERS.map(t => {
                                    const Icon = t.icon;
                                    const selected = ruleForm.trigger_type === t.value;
                                    return (
                                        <div
                                            key={t.value}
                                            onClick={() => setRuleForm(prev => ({ ...prev, trigger_type: t.value }))}
                                            className={cn(
                                                "p-[18px] rounded-xl cursor-pointer transition-all duration-150",
                                                selected
                                                    ? "border border-indigo-600 bg-indigo-600/15"
                                                    : "border border-border bg-neutral-100 dark:bg-neutral-800"
                                            )}
                                        >
                                            <Icon size={24} className={cn("mb-2.5", selected ? "text-indigo-600" : "text-muted-foreground")} />
                                            <div className="font-semibold text-sm mb-1">{t.label}</div>
                                            <div className="text-xs text-muted-foreground leading-relaxed">{t.desc}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* -- Step 1: Conditions -- */}
                    {wizardStep === 1 && (
                        <div>
                            <h2 className="text-lg font-semibold mb-1">
                                ¿Bajo qué condiciones se ejecuta?
                            </h2>
                            <p className="text-muted-foreground text-[13px] mb-5">
                                Todas las condiciones deben cumplirse (AND). Si no agregas condiciones, se ejecutará siempre.
                            </p>

                            {ruleForm.conditions.length === 0 && (
                                <div className="py-5 text-center text-muted-foreground text-[13px]">
                                    Sin condiciones — la regla se ejecutará siempre que ocurra el trigger
                                </div>
                            )}

                            <div className="flex flex-col gap-2.5">
                                {ruleForm.conditions.map((cond, idx) => (
                                    <div key={idx} className="flex gap-2 items-center p-2.5 px-3 rounded-[10px] bg-neutral-100 dark:bg-neutral-800 border border-border">
                                        <div className="flex-1">
                                            <Label className="text-xs font-semibold text-muted-foreground mb-1">Campo</Label>
                                            <select
                                                value={cond.field}
                                                onChange={e => updateCondition(idx, "field", e.target.value)}
                                                className="w-full p-2.5 px-3 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                            >
                                                {CONDITION_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex-1">
                                            <Label className="text-xs font-semibold text-muted-foreground mb-1">Operador</Label>
                                            <select
                                                value={cond.operator}
                                                onChange={e => updateCondition(idx, "operator", e.target.value)}
                                                className="w-full p-2.5 px-3 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                            >
                                                {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex-1">
                                            <Label className="text-xs font-semibold text-muted-foreground mb-1">Valor</Label>
                                            <Input
                                                value={cond.value}
                                                onChange={e => updateCondition(idx, "value", e.target.value)}
                                                placeholder="Valor"
                                                className="bg-background border-border"
                                            />
                                        </div>
                                        <button onClick={() => removeCondition(idx)} className="bg-transparent border-none text-red-500 cursor-pointer p-1 mt-[18px]">
                                            <X size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <button
                                onClick={addCondition}
                                className="flex items-center gap-1.5 mt-3.5 px-4 py-2 rounded-lg border border-dashed border-border bg-transparent text-indigo-600 text-[13px] font-semibold cursor-pointer"
                            >
                                <Plus size={14} /> Agregar condición
                            </button>
                        </div>
                    )}

                    {/* -- Step 2: Actions -- */}
                    {wizardStep === 2 && (
                        <div>
                            <h2 className="text-lg font-semibold mb-1">
                                ¿Qué acciones ejecutar?
                            </h2>
                            <p className="text-muted-foreground text-[13px] mb-5">
                                Define las acciones que se realizarán cuando se active la regla
                            </p>

                            {ruleForm.actions.length === 0 && (
                                <div className="py-5 text-center text-muted-foreground text-[13px]">
                                    Agrega al menos una acción
                                </div>
                            )}

                            <div className="flex flex-col gap-3">
                                {ruleForm.actions.map((action, idx) => (
                                    <div key={idx} className="p-4 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-border">
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex-1 mr-3">
                                                <Label className="text-xs font-semibold text-muted-foreground mb-1">Tipo de acción</Label>
                                                <select
                                                    value={action.type}
                                                    onChange={e => {
                                                        updateAction(idx, "type", e.target.value);
                                                        updateAction(idx, "config", {});
                                                    }}
                                                    className="w-full p-2.5 px-3 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                                >
                                                    {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                                                </select>
                                            </div>
                                            <button onClick={() => removeAction(idx)} className="bg-transparent border-none text-red-500 cursor-pointer p-1 mt-[18px]">
                                                <X size={16} />
                                            </button>
                                        </div>

                                        {/* Config fields per action type */}
                                        <div className="flex gap-2.5 flex-wrap">
                                            {action.type === "send_template" && (
                                                <>
                                                    <div className="flex-1 min-w-[180px]">
                                                        <Label className="text-xs font-semibold text-muted-foreground mb-1">Nombre de plantilla</Label>
                                                        <Input
                                                            value={action.config.template_name || ""}
                                                            onChange={e => updateActionConfig(idx, "template_name", e.target.value)}
                                                            placeholder="welcome_message"
                                                            className="bg-background border-border"
                                                        />
                                                    </div>
                                                    <div className="min-w-[120px]">
                                                        <Label className="text-xs font-semibold text-muted-foreground mb-1">Idioma</Label>
                                                        <select
                                                            value={action.config.language || "es"}
                                                            onChange={e => updateActionConfig(idx, "language", e.target.value)}
                                                            className="w-full p-2.5 px-3 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                                        >
                                                            <option value="es">Español</option>
                                                            <option value="en">English</option>
                                                            <option value="pt">Português</option>
                                                        </select>
                                                    </div>
                                                </>
                                            )}
                                            {action.type === "create_task" && (
                                                <>
                                                    <div className="flex-1 min-w-[200px]">
                                                        <Label className="text-xs font-semibold text-muted-foreground mb-1">Descripción de la tarea</Label>
                                                        <Input
                                                            value={action.config.task_description || ""}
                                                            onChange={e => updateActionConfig(idx, "task_description", e.target.value)}
                                                            placeholder="Dar seguimiento al lead"
                                                            className="bg-background border-border"
                                                        />
                                                    </div>
                                                    <div className="min-w-[120px]">
                                                        <Label className="text-xs font-semibold text-muted-foreground mb-1">Horas límite</Label>
                                                        <Input
                                                            type="number"
                                                            value={action.config.task_due_hours ?? 24}
                                                            onChange={e => updateActionConfig(idx, "task_due_hours", Number(e.target.value))}
                                                            className="bg-background border-border"
                                                        />
                                                    </div>
                                                </>
                                            )}
                                            {action.type === "change_stage" && (
                                                <div className="flex-1 min-w-[180px]">
                                                    <Label className="text-xs font-semibold text-muted-foreground mb-1">Etapa</Label>
                                                    <select
                                                        value={action.config.stage || ""}
                                                        onChange={e => updateActionConfig(idx, "stage", e.target.value)}
                                                        className="w-full p-2.5 px-3 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                                    >
                                                        <option value="" disabled>Seleccionar etapa</option>
                                                        {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                                    </select>
                                                </div>
                                            )}
                                            {action.type === "add_tag" && (
                                                <div className="flex-1 min-w-[180px]">
                                                    <Label className="text-xs font-semibold text-muted-foreground mb-1">Etiqueta</Label>
                                                    <Input
                                                        value={action.config.tag || ""}
                                                        onChange={e => updateActionConfig(idx, "tag", e.target.value)}
                                                        placeholder="vip"
                                                        className="bg-background border-border"
                                                    />
                                                </div>
                                            )}
                                            {action.type === "assign_agent" && (
                                                <div className="flex-1 min-w-[180px]">
                                                    <Label className="text-xs font-semibold text-muted-foreground mb-1">ID del agente</Label>
                                                    <Input
                                                        value={action.config.agent_id || ""}
                                                        onChange={e => updateActionConfig(idx, "agent_id", e.target.value)}
                                                        placeholder="ID del agente"
                                                        className="bg-background border-border"
                                                    />
                                                </div>
                                            )}

                                            <div className="min-w-[120px]">
                                                <Label className="text-xs font-semibold text-muted-foreground mb-1">Delay (segundos)</Label>
                                                <Input
                                                    type="number"
                                                    value={action.delay}
                                                    onChange={e => updateAction(idx, "delay", Number(e.target.value))}
                                                    min={0}
                                                    className="bg-background border-border"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <button
                                onClick={addAction}
                                className="flex items-center gap-1.5 mt-3.5 px-4 py-2 rounded-lg border border-dashed border-border bg-transparent text-indigo-600 text-[13px] font-semibold cursor-pointer"
                            >
                                <Plus size={14} /> Agregar acción
                            </button>
                        </div>
                    )}

                    {/* -- Step 3: Summary -- */}
                    {wizardStep === 3 && (
                        <div>
                            <h2 className="text-lg font-semibold mb-1">
                                Revisa y guarda tu regla
                            </h2>
                            <p className="text-muted-foreground text-[13px] mb-5">
                                Confirma los detalles antes de guardar
                            </p>

                            {/* Rule name */}
                            <div className="mb-[18px]">
                                <Label className="text-xs font-semibold text-muted-foreground mb-1">Nombre de la regla *</Label>
                                <Input
                                    value={ruleForm.name}
                                    onChange={e => setRuleForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="Ej: Auto-asignar leads nuevos"
                                    className="text-[15px] bg-background border-border"
                                />
                            </div>

                            {/* Active toggle */}
                            <div className="flex items-center gap-3 mb-6">
                                <button
                                    onClick={() => setRuleForm(prev => ({ ...prev, active: !prev.active }))}
                                    className={cn(
                                        "w-11 h-6 rounded-full border-none cursor-pointer relative transition-colors duration-200",
                                        ruleForm.active ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"
                                    )}
                                >
                                    <div className={cn(
                                        "w-[18px] h-[18px] rounded-full bg-white absolute top-[3px] transition-[left] duration-200 shadow-sm",
                                        ruleForm.active ? "left-[23px]" : "left-[3px]"
                                    )} />
                                </button>
                                <span className="text-sm">Activar regla inmediatamente</span>
                            </div>

                            {/* Summary cards */}
                            <div className="grid grid-cols-3 gap-3 mb-6">
                                {[
                                    { label: "Trigger", value: triggerLabel(ruleForm.trigger_type) },
                                    { label: "Condiciones", value: String(ruleForm.conditions.length) },
                                    { label: "Acciones", value: String(ruleForm.actions.length) },
                                ].map(item => (
                                    <div key={item.label} className="p-4 rounded-[10px] bg-neutral-100 dark:bg-neutral-800 border border-border text-center">
                                        <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
                                        <div className="font-semibold text-sm">{item.value}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Save button */}
                            <Button
                                onClick={handleSave}
                                disabled={!ruleForm.name}
                                className={cn(
                                    "w-full py-3.5 rounded-[10px] text-[15px] font-semibold transition-colors duration-200",
                                    ruleForm.name
                                        ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                                        : "bg-neutral-200 dark:bg-neutral-700 text-muted-foreground cursor-not-allowed"
                                )}
                            >
                                {editingRuleId ? "Actualizar Regla" : "Guardar Regla"}
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Navigation buttons */}
            <div className="flex justify-between mt-4">
                <Button
                    variant="outline"
                    onClick={() => {
                        if (wizardStep === 0) {
                            setWizardOpen(false);
                            setEditingRuleId(null);
                            setRuleForm(emptyRuleForm());
                        } else {
                            setWizardStep(prev => prev - 1);
                        }
                    }}
                    className="gap-1.5 border-border"
                >
                    <ChevronLeft size={16} /> {wizardStep === 0 ? "Cancelar" : "Anterior"}
                </Button>

                {wizardStep < 3 && (
                    <Button
                        onClick={() => setWizardStep(prev => prev + 1)}
                        disabled={!canNext(wizardStep)}
                        className={cn(
                            "gap-1.5",
                            canNext(wizardStep)
                                ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                                : "bg-neutral-200 dark:bg-neutral-700 text-muted-foreground cursor-not-allowed"
                        )}
                    >
                        Siguiente <ChevronRight size={16} />
                    </Button>
                )}
            </div>

            {/* Toast */}
            {toast && (
                <div className={cn(
                    "fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold text-white shadow-[0_4px_20px_rgba(0,0,0,0.3)] animate-in slide-in-from-bottom-2 fade-in duration-300",
                    toast.includes("eliminada") || toast.includes("Error") ? "bg-red-500" : "bg-emerald-500"
                )}>
                    {toast}
                </div>
            )}
        </div>
    );
}
