"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
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

// ── Trigger definitions ──
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

// ── Shared styles ──
const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", borderRadius: 8,
    border: "1px solid #2a2a45", background: "#0a0a12",
    color: "#e8e8f0", fontSize: 14, outline: "none", boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = { ...inputStyle };

const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12, fontWeight: 600,
    color: "#9898b0", marginBottom: 4,
};

const emptyRuleForm = () => ({
    name: "", trigger_type: "",
    conditions: [] as { field: string; operator: string; value: string }[],
    actions: [] as { type: string; config: Record<string, any>; delay: number }[],
    active: true,
});

export default function AutomationPage() {
    const { activeTenantId } = useTenant();

    // ── State ──
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

    // ── Load rules ──
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

    // ── Toast helper ──
    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(null), 2500);
    }

    // ── Toggle rule ──
    async function handleToggle(id: string, currentActive: boolean) {
        const next = !currentActive;
        setRules(prev => prev.map(r => r.id === id ? { ...r, active: next } : r));
        if (activeTenantId) {
            try { await api.toggleRule(activeTenantId, id, next); } catch {}
        }
    }

    // ── Delete rule ──
    async function handleDelete(id: string) {
        if (!confirm("¿Estás seguro de que deseas eliminar esta regla?")) return;
        setRules(prev => prev.filter(r => r.id !== id));
        if (activeTenantId) {
            try { await api.deleteRule(activeTenantId, id); } catch {}
        }
        showToast("Regla eliminada");
    }

    // ── Load executions ──
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

    // ── Edit rule ──
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

    // ── Save rule ──
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

    // ── Open new wizard ──
    function openNewWizard() {
        setRuleForm(emptyRuleForm());
        setEditingRuleId(null);
        setWizardStep(0);
        setWizardOpen(true);
    }

    // ── Condition helpers ──
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

    // ── Action helpers ──
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

    // ── Computed ──
    const activeCount = rules.filter(r => r.active).length;
    const totalExecs = rules.reduce((sum, r) => sum + Number(r.execution_count || 0), 0);

    const triggerLabel = (tt: string) => TRIGGERS.find(t => t.value === tt)?.label || tt;

    // ── Can advance step? ──
    const canNext = (step: number) => {
        if (step === 0) return !!ruleForm.trigger_type;
        if (step === 1) return true; // conditions optional
        if (step === 2) return ruleForm.actions.length > 0;
        return !!ruleForm.name;
    };

    // ══════════════════════════════════════════════════
    //  RENDER: Rules List
    // ══════════════════════════════════════════════════
    if (!wizardOpen) {
        return (
            <div style={{ color: "#e8e8f0" }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                            <Workflow size={28} color="#6c5ce7" /> Automatización
                        </h1>
                        <p style={{ color: "#9898b0", margin: "4px 0 0", fontSize: 14 }}>
                            Reglas automáticas para optimizar tu operación
                        </p>
                    </div>
                    <button onClick={openNewWizard} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
                        borderRadius: 10, border: "none", background: "#6c5ce7", color: "white",
                        fontWeight: 600, fontSize: 14, cursor: "pointer",
                    }}>
                        <Plus size={18} /> Nueva Regla
                    </button>
                </div>

                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
                    {[
                        { label: "Total reglas", value: rules.length, icon: Shield, color: "#6c5ce7" },
                        { label: "Reglas activas", value: activeCount, icon: Zap, color: "#00d68f" },
                        { label: "Ejecuciones totales", value: totalExecs, icon: BarChart3, color: "#ffaa00" },
                    ].map(stat => {
                        const Icon = stat.icon;
                        return (
                            <div key={stat.label} style={{
                                padding: "16px 18px", borderRadius: 12, border: "1px solid #2a2a45",
                                background: "#12121e", display: "flex", alignItems: "center", gap: 14,
                            }}>
                                <div style={{
                                    width: 42, height: 42, borderRadius: 10, display: "flex",
                                    alignItems: "center", justifyContent: "center",
                                    background: `${stat.color}22`,
                                }}>
                                    <Icon size={20} color={stat.color} />
                                </div>
                                <div>
                                    <div style={{ fontSize: 22, fontWeight: 700 }}>{stat.value}</div>
                                    <div style={{ fontSize: 12, color: "#9898b0" }}>{stat.label}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Rules list */}
                {loading ? (
                    <div style={{ textAlign: "center", padding: 40, color: "#9898b0" }}>Cargando reglas...</div>
                ) : rules.length === 0 ? (
                    <div style={{
                        textAlign: "center", padding: 60, borderRadius: 14,
                        border: "1px dashed #2a2a45", background: "#12121e", color: "#9898b0",
                    }}>
                        <Workflow size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
                        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Sin reglas de automatización</div>
                        <div style={{ fontSize: 13 }}>Crea tu primera regla para empezar a automatizar</div>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {rules.map(rule => (
                            <div key={rule.id}>
                                <div style={{
                                    padding: "16px 20px", borderRadius: 14, border: "1px solid #2a2a45",
                                    background: "#12121e", display: "flex", justifyContent: "space-between",
                                    alignItems: "center", opacity: rule.active ? 1 : 0.55,
                                    transition: "opacity 0.2s ease",
                                }}>
                                    {/* Left side */}
                                    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                                        <div style={{
                                            width: 10, height: 10, borderRadius: "50%",
                                            background: rule.active ? "#00d68f" : "#9898b0",
                                            flexShrink: 0,
                                        }} />
                                        <div>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                <span style={{ fontWeight: 600, fontSize: 15 }}>{rule.name}</span>
                                                <span style={{
                                                    fontSize: 10, padding: "2px 8px", borderRadius: 6,
                                                    background: "rgba(108, 92, 231, 0.15)", color: "#6c5ce7",
                                                    fontWeight: 600,
                                                }}>
                                                    {triggerLabel(rule.trigger_type)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right side */}
                                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                                        {/* Execution count badge */}
                                        <button onClick={() => handleLoadExecs(rule.id)} style={{
                                            display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                                            borderRadius: 6, border: "1px solid #2a2a45", background: execRuleId === rule.id ? "#1a1a2e" : "transparent",
                                            color: "#9898b0", fontSize: 12, cursor: "pointer",
                                        }}>
                                            <Activity size={12} /> {Number(rule.execution_count || 0)}
                                        </button>

                                        {/* Toggle */}
                                        <button onClick={() => handleToggle(rule.id, rule.active)} style={{
                                            width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
                                            background: rule.active ? "#00d68f" : "#2a2a45",
                                            position: "relative", transition: "background 0.2s ease",
                                        }}>
                                            <div style={{
                                                width: 18, height: 18, borderRadius: "50%", background: "white",
                                                position: "absolute", top: 3,
                                                left: rule.active ? 23 : 3,
                                                transition: "left 0.2s ease",
                                                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                                            }} />
                                        </button>

                                        {/* Edit */}
                                        <button onClick={() => handleEdit(rule)} style={{
                                            background: "none", border: "none", color: "#9898b0",
                                            cursor: "pointer", padding: 4,
                                        }}>
                                            <Pencil size={16} />
                                        </button>

                                        {/* Delete */}
                                        <button onClick={() => handleDelete(rule.id)} style={{
                                            background: "none", border: "none", color: "#ff4757",
                                            cursor: "pointer", padding: 4, opacity: 0.7,
                                        }}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>

                                {/* Execution history panel */}
                                {execRuleId === rule.id && selectedRuleExecs !== null && (
                                    <div style={{
                                        margin: "0 8px", padding: "14px 18px", borderRadius: "0 0 12px 12px",
                                        border: "1px solid #2a2a45", borderTop: "none",
                                        background: "#1a1a2e",
                                    }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: "#e8e8f0" }}>
                                                Historial de ejecuciones
                                            </span>
                                            <button onClick={() => { setSelectedRuleExecs(null); setExecRuleId(null); }} style={{
                                                background: "none", border: "none", color: "#9898b0",
                                                cursor: "pointer", fontSize: 12, textDecoration: "underline",
                                            }}>
                                                Cerrar
                                            </button>
                                        </div>
                                        {selectedRuleExecs.length === 0 ? (
                                            <div style={{ fontSize: 13, color: "#9898b0", padding: "8px 0" }}>
                                                Sin ejecuciones registradas
                                            </div>
                                        ) : (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                                {selectedRuleExecs.slice(0, 10).map((exec: any, i: number) => {
                                                    const statusColor = exec.status === "success" ? "#00d68f"
                                                        : exec.status === "failed" ? "#ff4757" : "#ffaa00";
                                                    return (
                                                        <div key={exec.id || i} style={{
                                                            display: "flex", alignItems: "center", gap: 12,
                                                            padding: "8px 10px", borderRadius: 8,
                                                            background: "#12121e", fontSize: 13,
                                                        }}>
                                                            <div style={{
                                                                width: 8, height: 8, borderRadius: "50%",
                                                                background: statusColor, flexShrink: 0,
                                                            }} />
                                                            <span style={{ color: statusColor, fontWeight: 600, minWidth: 60 }}>
                                                                {exec.status || "queued"}
                                                            </span>
                                                            <span style={{ color: "#9898b0", fontSize: 12 }}>
                                                                {exec.started_at ? new Date(exec.started_at).toLocaleString("es-CO") : "—"}
                                                            </span>
                                                            <span style={{ color: "#9898b0", fontSize: 12 }}>
                                                                → {exec.finished_at ? new Date(exec.finished_at).toLocaleString("es-CO") : "—"}
                                                            </span>
                                                            {exec.result && (
                                                                <span style={{ color: "#9898b0", fontSize: 11, marginLeft: "auto", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                    <div style={{
                        position: "fixed", bottom: 24, right: 24, zIndex: 1100,
                        padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600,
                        background: toast.includes("eliminada") || toast.includes("Error") ? "#ff4757" : "#00d68f",
                        color: "white", boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                        animation: "slideUp 0.3s ease",
                    }}>
                        {toast}
                    </div>
                )}
                <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
            </div>
        );
    }

    // ══════════════════════════════════════════════════
    //  RENDER: Wizard
    // ══════════════════════════════════════════════════
    return (
        <div style={{ color: "#e8e8f0" }}>
            {/* Wizard header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                <button onClick={() => { setWizardOpen(false); setEditingRuleId(null); setRuleForm(emptyRuleForm()); }} style={{
                    background: "none", border: "none", color: "#9898b0",
                    cursor: "pointer", fontSize: 14,
                }}>
                    <ChevronLeft size={20} />
                </button>
                <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
                    {editingRuleId ? "Editar Regla" : "Nueva Regla"}
                </h1>
            </div>

            {/* Step indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 32 }}>
                {STEP_LABELS.map((label, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", flex: i < STEP_LABELS.length - 1 ? 1 : "none" }}>
                        <div
                            onClick={() => { if (i <= wizardStep) setWizardStep(i); }}
                            style={{
                                display: "flex", alignItems: "center", gap: 8, cursor: i <= wizardStep ? "pointer" : "default",
                            }}
                        >
                            <div style={{
                                width: 32, height: 32, borderRadius: "50%",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 13, fontWeight: 700,
                                background: i < wizardStep ? "#00d68f" : i === wizardStep ? "#6c5ce7" : "#2a2a45",
                                color: i <= wizardStep ? "white" : "#9898b0",
                                transition: "all 0.2s ease",
                            }}>
                                {i < wizardStep ? <Check size={14} /> : i + 1}
                            </div>
                            <span style={{
                                fontSize: 13, fontWeight: i === wizardStep ? 600 : 400,
                                color: i === wizardStep ? "#e8e8f0" : "#9898b0",
                                whiteSpace: "nowrap",
                            }}>
                                {label}
                            </span>
                        </div>
                        {i < STEP_LABELS.length - 1 && (
                            <div style={{
                                flex: 1, height: 2, margin: "0 12px",
                                background: i < wizardStep ? "#00d68f" : "#2a2a45",
                                transition: "background 0.2s ease",
                            }} />
                        )}
                    </div>
                ))}
            </div>

            {/* Step content */}
            <div style={{
                padding: 24, borderRadius: 14, border: "1px solid #2a2a45",
                background: "#12121e", minHeight: 300,
            }}>

                {/* ── Step 0: Trigger ── */}
                {wizardStep === 0 && (
                    <div>
                        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>
                            ¿Qué evento activa esta regla?
                        </h2>
                        <p style={{ color: "#9898b0", fontSize: 13, margin: "0 0 20px" }}>
                            Selecciona el evento que disparará la ejecución
                        </p>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                            {TRIGGERS.map(t => {
                                const Icon = t.icon;
                                const selected = ruleForm.trigger_type === t.value;
                                return (
                                    <div
                                        key={t.value}
                                        onClick={() => setRuleForm(prev => ({ ...prev, trigger_type: t.value }))}
                                        style={{
                                            padding: 18, borderRadius: 12, cursor: "pointer",
                                            border: selected ? "1px solid #6c5ce7" : "1px solid #2a2a45",
                                            background: selected ? "rgba(108, 92, 231, 0.15)" : "#1a1a2e",
                                            transition: "all 0.15s ease",
                                        }}
                                    >
                                        <Icon size={24} color={selected ? "#6c5ce7" : "#9898b0"} style={{ marginBottom: 10 }} />
                                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{t.label}</div>
                                        <div style={{ fontSize: 12, color: "#9898b0", lineHeight: 1.4 }}>{t.desc}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ── Step 1: Conditions ── */}
                {wizardStep === 1 && (
                    <div>
                        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>
                            ¿Bajo qué condiciones se ejecuta?
                        </h2>
                        <p style={{ color: "#9898b0", fontSize: 13, margin: "0 0 20px" }}>
                            Todas las condiciones deben cumplirse (AND). Si no agregas condiciones, se ejecutará siempre.
                        </p>

                        {ruleForm.conditions.length === 0 && (
                            <div style={{ padding: "20px 0", textAlign: "center", color: "#9898b0", fontSize: 13 }}>
                                Sin condiciones — la regla se ejecutará siempre que ocurra el trigger
                            </div>
                        )}

                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {ruleForm.conditions.map((cond, idx) => (
                                <div key={idx} style={{
                                    display: "flex", gap: 8, alignItems: "center",
                                    padding: "10px 12px", borderRadius: 10,
                                    background: "#1a1a2e", border: "1px solid #2a2a45",
                                }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={labelStyle}>Campo</label>
                                        <select value={cond.field} onChange={e => updateCondition(idx, "field", e.target.value)} style={selectStyle}>
                                            {CONDITION_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                        </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={labelStyle}>Operador</label>
                                        <select value={cond.operator} onChange={e => updateCondition(idx, "operator", e.target.value)} style={selectStyle}>
                                            {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={labelStyle}>Valor</label>
                                        <input value={cond.value} onChange={e => updateCondition(idx, "value", e.target.value)} placeholder="Valor" style={inputStyle} />
                                    </div>
                                    <button onClick={() => removeCondition(idx)} style={{
                                        background: "none", border: "none", color: "#ff4757",
                                        cursor: "pointer", padding: 4, marginTop: 18,
                                    }}>
                                        <X size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <button onClick={addCondition} style={{
                            display: "flex", alignItems: "center", gap: 6, marginTop: 14,
                            padding: "8px 16px", borderRadius: 8, border: "1px dashed #2a2a45",
                            background: "transparent", color: "#6c5ce7", fontSize: 13,
                            fontWeight: 600, cursor: "pointer",
                        }}>
                            <Plus size={14} /> Agregar condición
                        </button>
                    </div>
                )}

                {/* ── Step 2: Actions ── */}
                {wizardStep === 2 && (
                    <div>
                        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>
                            ¿Qué acciones ejecutar?
                        </h2>
                        <p style={{ color: "#9898b0", fontSize: 13, margin: "0 0 20px" }}>
                            Define las acciones que se realizarán cuando se active la regla
                        </p>

                        {ruleForm.actions.length === 0 && (
                            <div style={{ padding: "20px 0", textAlign: "center", color: "#9898b0", fontSize: 13 }}>
                                Agrega al menos una acción
                            </div>
                        )}

                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {ruleForm.actions.map((action, idx) => (
                                <div key={idx} style={{
                                    padding: 16, borderRadius: 12,
                                    background: "#1a1a2e", border: "1px solid #2a2a45",
                                }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                                        <div style={{ flex: 1, marginRight: 12 }}>
                                            <label style={labelStyle}>Tipo de acción</label>
                                            <select
                                                value={action.type}
                                                onChange={e => {
                                                    updateAction(idx, "type", e.target.value);
                                                    updateAction(idx, "config", {});
                                                }}
                                                style={selectStyle}
                                            >
                                                {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                                            </select>
                                        </div>
                                        <button onClick={() => removeAction(idx)} style={{
                                            background: "none", border: "none", color: "#ff4757",
                                            cursor: "pointer", padding: 4, marginTop: 18,
                                        }}>
                                            <X size={16} />
                                        </button>
                                    </div>

                                    {/* Config fields per action type */}
                                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                        {action.type === "send_template" && (
                                            <>
                                                <div style={{ flex: 1, minWidth: 180 }}>
                                                    <label style={labelStyle}>Nombre de plantilla</label>
                                                    <input
                                                        value={action.config.template_name || ""}
                                                        onChange={e => updateActionConfig(idx, "template_name", e.target.value)}
                                                        placeholder="welcome_message"
                                                        style={inputStyle}
                                                    />
                                                </div>
                                                <div style={{ minWidth: 120 }}>
                                                    <label style={labelStyle}>Idioma</label>
                                                    <select value={action.config.language || "es"} onChange={e => updateActionConfig(idx, "language", e.target.value)} style={selectStyle}>
                                                        <option value="es">Español</option>
                                                        <option value="en">English</option>
                                                        <option value="pt">Português</option>
                                                    </select>
                                                </div>
                                            </>
                                        )}
                                        {action.type === "create_task" && (
                                            <>
                                                <div style={{ flex: 1, minWidth: 200 }}>
                                                    <label style={labelStyle}>Descripción de la tarea</label>
                                                    <input
                                                        value={action.config.task_description || ""}
                                                        onChange={e => updateActionConfig(idx, "task_description", e.target.value)}
                                                        placeholder="Dar seguimiento al lead"
                                                        style={inputStyle}
                                                    />
                                                </div>
                                                <div style={{ minWidth: 120 }}>
                                                    <label style={labelStyle}>Horas límite</label>
                                                    <input
                                                        type="number"
                                                        value={action.config.task_due_hours ?? 24}
                                                        onChange={e => updateActionConfig(idx, "task_due_hours", Number(e.target.value))}
                                                        style={inputStyle}
                                                    />
                                                </div>
                                            </>
                                        )}
                                        {action.type === "change_stage" && (
                                            <div style={{ flex: 1, minWidth: 180 }}>
                                                <label style={labelStyle}>Etapa</label>
                                                <select value={action.config.stage || ""} onChange={e => updateActionConfig(idx, "stage", e.target.value)} style={selectStyle}>
                                                    <option value="" disabled>Seleccionar etapa</option>
                                                    {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                                </select>
                                            </div>
                                        )}
                                        {action.type === "add_tag" && (
                                            <div style={{ flex: 1, minWidth: 180 }}>
                                                <label style={labelStyle}>Etiqueta</label>
                                                <input
                                                    value={action.config.tag || ""}
                                                    onChange={e => updateActionConfig(idx, "tag", e.target.value)}
                                                    placeholder="vip"
                                                    style={inputStyle}
                                                />
                                            </div>
                                        )}
                                        {action.type === "assign_agent" && (
                                            <div style={{ flex: 1, minWidth: 180 }}>
                                                <label style={labelStyle}>ID del agente</label>
                                                <input
                                                    value={action.config.agent_id || ""}
                                                    onChange={e => updateActionConfig(idx, "agent_id", e.target.value)}
                                                    placeholder="ID del agente"
                                                    style={inputStyle}
                                                />
                                            </div>
                                        )}

                                        <div style={{ minWidth: 120 }}>
                                            <label style={labelStyle}>Delay (segundos)</label>
                                            <input
                                                type="number"
                                                value={action.delay}
                                                onChange={e => updateAction(idx, "delay", Number(e.target.value))}
                                                min={0}
                                                style={inputStyle}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <button onClick={addAction} style={{
                            display: "flex", alignItems: "center", gap: 6, marginTop: 14,
                            padding: "8px 16px", borderRadius: 8, border: "1px dashed #2a2a45",
                            background: "transparent", color: "#6c5ce7", fontSize: 13,
                            fontWeight: 600, cursor: "pointer",
                        }}>
                            <Plus size={14} /> Agregar acción
                        </button>
                    </div>
                )}

                {/* ── Step 3: Summary ── */}
                {wizardStep === 3 && (
                    <div>
                        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>
                            Revisa y guarda tu regla
                        </h2>
                        <p style={{ color: "#9898b0", fontSize: 13, margin: "0 0 20px" }}>
                            Confirma los detalles antes de guardar
                        </p>

                        {/* Rule name */}
                        <div style={{ marginBottom: 18 }}>
                            <label style={labelStyle}>Nombre de la regla *</label>
                            <input
                                value={ruleForm.name}
                                onChange={e => setRuleForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Ej: Auto-asignar leads nuevos"
                                style={{ ...inputStyle, fontSize: 15 }}
                            />
                        </div>

                        {/* Active toggle */}
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                            <button onClick={() => setRuleForm(prev => ({ ...prev, active: !prev.active }))} style={{
                                width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
                                background: ruleForm.active ? "#00d68f" : "#2a2a45",
                                position: "relative", transition: "background 0.2s ease",
                            }}>
                                <div style={{
                                    width: 18, height: 18, borderRadius: "50%", background: "white",
                                    position: "absolute", top: 3,
                                    left: ruleForm.active ? 23 : 3,
                                    transition: "left 0.2s ease",
                                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                                }} />
                            </button>
                            <span style={{ fontSize: 14 }}>Activar regla inmediatamente</span>
                        </div>

                        {/* Summary cards */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
                            <div style={{
                                padding: 16, borderRadius: 10, background: "#1a1a2e",
                                border: "1px solid #2a2a45", textAlign: "center",
                            }}>
                                <div style={{ fontSize: 12, color: "#9898b0", marginBottom: 4 }}>Trigger</div>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>{triggerLabel(ruleForm.trigger_type)}</div>
                            </div>
                            <div style={{
                                padding: 16, borderRadius: 10, background: "#1a1a2e",
                                border: "1px solid #2a2a45", textAlign: "center",
                            }}>
                                <div style={{ fontSize: 12, color: "#9898b0", marginBottom: 4 }}>Condiciones</div>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>{ruleForm.conditions.length}</div>
                            </div>
                            <div style={{
                                padding: 16, borderRadius: 10, background: "#1a1a2e",
                                border: "1px solid #2a2a45", textAlign: "center",
                            }}>
                                <div style={{ fontSize: 12, color: "#9898b0", marginBottom: 4 }}>Acciones</div>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>{ruleForm.actions.length}</div>
                            </div>
                        </div>

                        {/* Save button */}
                        <button
                            onClick={handleSave}
                            disabled={!ruleForm.name}
                            style={{
                                width: "100%", padding: "14px", borderRadius: 10, border: "none",
                                background: ruleForm.name ? "#6c5ce7" : "#2a2a45",
                                color: "white", fontSize: 15, fontWeight: 700, cursor: ruleForm.name ? "pointer" : "not-allowed",
                                transition: "background 0.2s ease",
                            }}
                        >
                            {editingRuleId ? "Actualizar Regla" : "Guardar Regla"}
                        </button>
                    </div>
                )}
            </div>

            {/* Navigation buttons */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
                <button
                    onClick={() => {
                        if (wizardStep === 0) {
                            setWizardOpen(false);
                            setEditingRuleId(null);
                            setRuleForm(emptyRuleForm());
                        } else {
                            setWizardStep(prev => prev - 1);
                        }
                    }}
                    style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "10px 20px", borderRadius: 10,
                        border: "1px solid #2a2a45", background: "transparent",
                        color: "#e8e8f0", fontSize: 14, cursor: "pointer",
                    }}
                >
                    <ChevronLeft size={16} /> {wizardStep === 0 ? "Cancelar" : "Anterior"}
                </button>

                {wizardStep < 3 && (
                    <button
                        onClick={() => setWizardStep(prev => prev + 1)}
                        disabled={!canNext(wizardStep)}
                        style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "10px 20px", borderRadius: 10, border: "none",
                            background: canNext(wizardStep) ? "#6c5ce7" : "#2a2a45",
                            color: "white", fontSize: 14, fontWeight: 600,
                            cursor: canNext(wizardStep) ? "pointer" : "not-allowed",
                        }}
                    >
                        Siguiente <ChevronRight size={16} />
                    </button>
                )}
            </div>

            {/* Toast */}
            {toast && (
                <div style={{
                    position: "fixed", bottom: 24, right: 24, zIndex: 1100,
                    padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600,
                    background: toast.includes("eliminada") || toast.includes("Error") ? "#ff4757" : "#00d68f",
                    color: "white", boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                    animation: "slideUp 0.3s ease",
                }}>
                    {toast}
                </div>
            )}
            <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </div>
    );
}
