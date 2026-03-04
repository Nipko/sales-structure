"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
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

// ============================================
// MOCK DATA
// ============================================

const mockRules = [
    {
        id: "r1", name: "Auto-asignar conversaciones nuevas", type: "auto_assign" as const,
        trigger: "new_conversation", isActive: true, executionCount: 47,
        lastExecutedAt: "Hace 3 min",
        description: "Asigna nuevas conversaciones a agentes disponibles usando round-robin",
        conditions: {}, actions: { method: "round_robin" },
    },
    {
        id: "r2", name: "Etiquetar interesados en rafting", type: "auto_tag" as const,
        trigger: "new_message", isActive: true, executionCount: 23,
        lastExecutedAt: "Hace 15 min",
        description: "Cuando el mensaje menciona rafting, río, chicamocha → agrega tag 'interesado-rafting'",
        conditions: { keywords: ["rafting", "río", "chicamocha", "rápidos"] }, actions: { tag: "interesado-rafting" },
    },
    {
        id: "r3", name: "Etiquetar interesados en parapente", type: "auto_tag" as const,
        trigger: "new_message", isActive: true, executionCount: 15,
        lastExecutedAt: "Hace 42 min",
        description: "Cuando el mensaje menciona parapente, vuelo, volar → agrega tag 'interesado-parapente'",
        conditions: { keywords: ["parapente", "vuelo", "volar", "paragliding"] }, actions: { tag: "interesado-parapente" },
    },
    {
        id: "r4", name: "SLA: Responder en 10 minutos", type: "sla_alert" as const,
        trigger: "conversation_assigned", isActive: true, executionCount: 5,
        lastExecutedAt: "Hace 2 horas",
        description: "Si un agente no responde en 10 min → notificación. 20 min → escalación a admin",
        conditions: { max_response_minutes: 10 }, actions: { notify: "admin", escalate_after_minutes: 20 },
    },
    {
        id: "r5", name: "Follow-up clientes inactivos", type: "follow_up" as const,
        trigger: "inactivity", isActive: false, executionCount: 0,
        lastExecutedAt: null,
        description: "Si un contacto no responde en 48 horas → enviar mensaje de seguimiento automático",
        conditions: { hours_inactive: 48 }, actions: { message: "¡Hola! ¿Pudiste revisar nuestra propuesta? Estamos aquí para ayudarte 😊" },
    },
];

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
    const { user } = useAuth();
    const [rules, setRules] = useState(mockRules);
    const [isLive, setIsLive] = useState(false);

    // Load automation rules from API
    useEffect(() => {
        async function load() {
            if (!user?.tenantId) return;
            const result = await api.getAutomationRules(user.tenantId);
            if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                setRules(result.data as any);
                setIsLive(true);
            }
        }
        load();
    }, [user?.tenantId]);

    const toggleRule = async (id: string) => {
        setRules(prev => prev.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r));
        if (user?.tenantId) await api.toggleRule(user.tenantId, id);
    };

    const activeCount = rules.filter(r => r.isActive).length;
    const totalExecutions = rules.reduce((sum, r) => sum + r.executionCount, 0);

    return (
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
                <button style={{
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
                                <button style={{
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
}
