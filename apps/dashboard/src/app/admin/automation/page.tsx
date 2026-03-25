"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import {
    Zap,
    Plus,
    Power,
    Trash2,
    Users,
    Tag,
    Clock,
    MessageSquare,
    ArrowRight,
    Settings,
    Activity,
    Shield,
    ChevronDown,
} from "lucide-react";

const typeConfig: Record<string, { icon: any; color: string; label: string }> = {
    auto_assign: { icon: Users, color: "#3498db", label: "Auto-asignación" },
    auto_tag: { icon: Tag, color: "#9b59b6", label: "Auto-etiqueta" },
    sla_alert: { icon: Clock, color: "#e67e22", label: "Alerta SLA" },
    auto_reply: { icon: MessageSquare, color: "#2ecc71", label: "Auto-respuesta" },
    follow_up: { icon: ArrowRight, color: "#f39c12", label: "Follow-up" },
};

const triggerLabels: Record<string, string> = {
    new_conversation: "Conversación nueva",
    new_message: "Mensaje nuevo",
    conversation_assigned: "Conversación asignada",
    inactivity: "Inactividad del contacto",
};

export default function AutomationPage() {
    const { activeTenantId } = useTenant();
    const [rules, setRules] = useState<any[]>([]);
    const [isLive, setIsLive] = useState(false);
    const [showNewRule, setShowNewRule] = useState(false);
    const [newRule, setNewRule] = useState({ name: "", type: "auto_assign", trigger: "new_conversation", description: "" });
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    // Load automation rules from API
    useEffect(() => {
        async function load() {
            if (!activeTenantId) return;
            try {
                const result = await api.getAutomationRules(activeTenantId);
                const data = result.success && Array.isArray(result.data) ? result.data : [];
                if (result.success) {
                    // Map DB format to UI format
                    const mapped = data.map(r => ({
                        id: r.id,
                        name: r.name,
                        type: r.trigger_type === 'lead.captured' ? 'auto_reply' : 'auto_assign',
                        trigger: r.trigger_type,
                        description: `Rule for ${r.trigger_type}`,
                        isActive: r.active,
                        executionCount: 0, // Mock for now until we have an endpoint for executions
                        lastExecutedAt: null,
                    }));
                    setRules(mapped);
                    setIsLive(true);
                }
            } catch (err) {
                console.error("Error loading rules", err);
            }
        }
        load();
    }, [activeTenantId]);

    const toggleRule = async (id: string) => {
        const current = rules.find(r => r.id === id);
        const nextState = !(current?.isActive ?? false);
        setRules(prev => prev.map(r => r.id === id ? { ...r, isActive: nextState } : r));
        if (activeTenantId) await api.toggleRule(activeTenantId, id, nextState);
    };

    const deleteRule = async (id: string) => {
        setRules(prev => prev.filter(r => r.id !== id));
        if (activeTenantId) await api.deleteRule(activeTenantId, id);
        setToast("Regla eliminada");
        setTimeout(() => setToast(null), 2000);
    };

    const handleCreateRule = async () => {
        if (!newRule.name) return;
        setSaving(true);
        try {
            const ruleData = {
                name: newRule.name,
                trigger_type: newRule.trigger,
                conditions_json: {},
                actions_json: [
                    { type: "sendTemplate", config: { templateName: "welcome_message" } }
                ],
                active: true
            };
            if (activeTenantId) {
                const result = await api.createRule(activeTenantId, ruleData);
                const created = result.success ? result.data : null;
                
                if (created && created.id) {
                    setRules(prev => [{
                        id: created.id,
                        name: created.name,
                        type: newRule.type,
                        trigger: created.trigger_type,
                        description: newRule.description || `Rule for ${created.trigger_type}`,
                        isActive: created.active,
                        executionCount: 0,
                        lastExecutedAt: null as any,
                        conditions: {},
                        actions: {},
                    }, ...prev]);
                    setShowNewRule(false);
                    setNewRule({ name: "", type: "auto_assign", trigger: "lead.captured", description: "" });
                    setToast("Regla creada exitosamente");
                    setTimeout(() => setToast(null), 2000);
                }
            }
        } catch (err) {
            console.error(err);
        } finally {
            setSaving(false);
        }
    };

    const activeCount = rules.filter(r => r.isActive).length;
    const totalExecutions = rules.reduce((sum, r) => sum + r.executionCount, 0);

    const content = (
        <div>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                        <Zap size={28} color="var(--accent)" /> Automatización
                        <DataSourceBadge isLive={isLive} />
                    </h1>
                    <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                        {activeCount} reglas activas · {totalExecutions} ejecuciones totales
                    </p>
                </div>
                <button onClick={() => setShowNewRule(true)} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
                    borderRadius: 10, border: "none", background: "var(--accent)", color: "white",
                    fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}>
                    <Plus size={18} /> Nueva regla
                </button>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
                {Object.entries(typeConfig).slice(0, 4).map(([key, config]) => {
                    const Icon = config.icon;
                    const count = rules.filter(r => r.type === key).length;
                    return (
                        <div key={key} style={{
                            padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border)",
                            background: "var(--bg-secondary)", display: "flex", alignItems: "center", gap: 12,
                        }}>
                            <div style={{
                                width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
                                background: `${config.color}22`,
                            }}>
                                <Icon size={20} color={config.color} />
                            </div>
                            <div>
                                <div style={{ fontSize: 18, fontWeight: 700 }}>{count}</div>
                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{config.label}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Rules List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {rules.map(rule => {
                    const config = typeConfig[rule.type] || typeConfig.auto_assign;
                    const Icon = config.icon;

                    return (
                        <div
                            key={rule.id}
                            style={{
                                padding: "16px 20px", borderRadius: 14, border: "1px solid var(--border)",
                                background: "var(--bg-secondary)", display: "flex", justifyContent: "space-between",
                                alignItems: "center", opacity: rule.isActive ? 1 : 0.6,
                                transition: "all 0.2s ease",
                            }}
                        >
                            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flex: 1 }}>
                                <div style={{
                                    width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
                                    background: `${config.color}22`, flexShrink: 0,
                                }}>
                                    <Icon size={22} color={config.color} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ fontWeight: 600, fontSize: 15 }}>{rule.name}</span>
                                        <span style={{
                                            fontSize: 10, padding: "2px 8px", borderRadius: 6,
                                            background: `${config.color}22`, color: config.color, fontWeight: 600,
                                        }}>
                                            {config.label}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.4 }}>
                                        {rule.description}
                                    </div>
                                    <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                            <Zap size={12} /> Trigger: {triggerLabels[rule.trigger] || rule.trigger}
                                        </span>
                                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                            <Activity size={12} /> {rule.executionCount} ejecuciones
                                        </span>
                                        {rule.lastExecutedAt && (
                                            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                <Clock size={12} /> {rule.lastExecutedAt}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                                {/* Toggle Switch */}
                                <button
                                    onClick={() => toggleRule(rule.id)}
                                    style={{
                                        width: 48, height: 26, borderRadius: 13, border: "none", cursor: "pointer",
                                        background: rule.isActive ? "#2ecc71" : "var(--bg-tertiary)",
                                        position: "relative", transition: "background 0.2s ease",
                                    }}
                                >
                                    <div style={{
                                        width: 20, height: 20, borderRadius: "50%", background: "white",
                                        position: "absolute", top: 3,
                                        left: rule.isActive ? 25 : 3,
                                        transition: "left 0.2s ease",
                                        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                                    }} />
                                </button>
                                <button style={{
                                    background: "none", border: "none", color: "var(--text-secondary)",
                                    cursor: "pointer", padding: 4,
                                }}>
                                    <Settings size={16} />
                                </button>
                                <button onClick={() => deleteRule(rule.id)} style={{
                                    background: "none", border: "none", color: "#e74c3c",
                                    cursor: "pointer", padding: 4, opacity: 0.6,
                                }}>
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    const ruleTypes = [
        { value: "auto_assign", label: "Auto-asignación" },
        { value: "auto_tag", label: "Auto-etiqueta" },
        { value: "sla_alert", label: "Alerta SLA" },
        { value: "auto_reply", label: "Auto-respuesta" },
        { value: "follow_up", label: "Follow-up" },
    ];

    const triggerOpts = [
        { value: "lead.captured", label: "Lead Capturado (Intake)" },
        { value: "new_conversation", label: "Nueva conversación" },
        { value: "message_received", label: "Mensaje recibido" },
        { value: "sla_timeout", label: "Timeout SLA" },
        { value: "inactivity", label: "Inactividad" },
    ];

    const modalOverlay = showNewRule ? (
        <div style={{
            position: "fixed", inset: 0, zIndex: 1000, display: "flex",
            alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
        }} onClick={() => setShowNewRule(false)}>
            <div onClick={e => e.stopPropagation()} style={{
                width: 440, padding: 28, borderRadius: 18,
                background: "var(--bg-secondary)", border: "1px solid var(--border)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Nueva Regla de Automatización</h2>
                <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Nombre</label>
                    <input value={newRule.name} onChange={e => setNewRule(p => ({ ...p, name: e.target.value }))} placeholder="Asignar nuevas conversaciones" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" as const }} />
                </div>
                <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Tipo</label>
                    <select value={newRule.type} onChange={e => setNewRule(p => ({ ...p, type: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" as const }}>
                        {ruleTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                </div>
                <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Trigger</label>
                    <select value={newRule.trigger} onChange={e => setNewRule(p => ({ ...p, trigger: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" as const }}>
                        {triggerOpts.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                </div>
                <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Descripción</label>
                    <textarea value={newRule.description} onChange={e => setNewRule(p => ({ ...p, description: e.target.value }))} placeholder="Descripción de la regla..." rows={3} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" as const, resize: "vertical" as const }} />
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <button onClick={() => setShowNewRule(false)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 14, cursor: "pointer" }}>Cancelar</button>
                    <button onClick={handleCreateRule} disabled={saving || !newRule.name} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: saving ? "var(--border)" : "var(--accent)", color: "white", fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}>{saving ? "Guardando..." : "Crear Regla"}</button>
                </div>
            </div>
        </div>
    ) : null;

    const toastElement = toast ? (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1100, padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, background: toast?.includes("eliminada") ? "#e74c3c" : "#2ecc71", color: "white", boxShadow: "0 4px 20px rgba(0,0,0,0.2)", animation: "slideUp 0.3s ease" }}>
            ✓ {toast}
        </div>
    ) : null;

    return (
        <>
            {content}
            {modalOverlay}
            {toastElement}
            <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </>
    );
}
