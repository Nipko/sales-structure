"use client";

import { useState, useEffect, useCallback } from "react";
import { useTenant } from "@/contexts/TenantContext";
import {
    TrendingUp, Users, MessageSquare, CheckSquare, Bot,
    AlertTriangle, Phone, Shield, Clock, Zap, BarChart2,
    ArrowUpRight, ArrowDownRight, Activity, RefreshCw,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1";

const STAGE_COLORS: Record<string, string> = {
    nuevo: "#95a5a6", contactado: "#3498db", respondio: "#9b59b6",
    calificado: "#f39c12", tibio: "#e67e22", caliente: "#e74c3c",
    listo_cierre: "#27ae60", ganado: "#2ecc71", perdido: "#7f8c8d",
};

function StatCard({ title, value, sub, icon: Icon, trend, color = "var(--accent)" }: {
    title: string; value: string | number; sub?: string; icon: any;
    trend?: number; color?: string;
}) {
    return (
        <div style={{
            background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)",
            padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8,
        }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</span>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={16} color={color} />
                </div>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{value}</div>
            {(sub || trend !== undefined) && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>
                    {trend !== undefined && (
                        trend >= 0
                            ? <ArrowUpRight size={14} color="#2ecc71" />
                            : <ArrowDownRight size={14} color="#e74c3c" />
                    )}
                    {sub}
                </div>
            )}
        </div>
    );
}

const TABS = [
    { key: "ejecutivo", label: "Ejecutivo", icon: TrendingUp },
    { key: "operativo", label: "Operativo CRM", icon: Users },
    { key: "whatsapp", label: "WhatsApp", icon: Phone },
    { key: "ia", label: "IA / Carla", icon: Bot },
    { key: "compliance", label: "Compliance", icon: Shield },
    { key: "audit", label: "Auditoría", icon: Clock },
];

export default function AnalyticsDashboardPage() {
    const { activeTenantId } = useTenant();
    const [activeTab, setActiveTab] = useState("ejecutivo");
    const [loading, setLoading] = useState(false);
    const [exec, setExec] = useState<any>(null);
    const [crm, setCrm] = useState<any>(null);
    const [wa, setWa] = useState<any>(null);
    const [ai, setAi] = useState<any>(null);
    const [compliance, setCompliance] = useState<any>(null);
    const [auditLogs, setAuditLogs] = useState<any[]>([]);

    const tenantId = activeTenantId;

    const load = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const [r1, r2, r3, r4, r5, r6] = await Promise.all([
                fetch(`${API}/analytics/dashboard/${tenantId}`),
                fetch(`${API}/analytics/crm/${tenantId}`),
                fetch(`${API}/analytics/whatsapp/${tenantId}`),
                fetch(`${API}/analytics/ai/${tenantId}`),
                fetch(`${API}/analytics/compliance/${tenantId}`),
                fetch(`${API}/analytics/audit/${tenantId}?limit=30`),
            ]);
            const [d1, d2, d3, d4, d5, d6] = await Promise.all([r1.json(), r2.json(), r3.json(), r4.json(), r5.json(), r6.json()]);
            setExec(d1.data);
            setCrm(d2.data);
            setWa(d3.data);
            setAi(d4.data);
            setCompliance(d5.data);
            setAuditLogs(d6.data || []);
        } catch (e) {
            console.error("Error loading analytics:", e);
        } finally {
            setLoading(false);
        }
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    const renderTab = () => {
        switch (activeTab) {
            case "ejecutivo":
                return (
                    <div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                            <StatCard title="Conversaciones Hoy" value={exec?.today?.conversations ?? "—"} icon={MessageSquare} color="#3498db" />
                            <StatCard title="Handoffs Activos" value={exec?.today?.handoffs ?? "—"} icon={AlertTriangle} color="#e67e22" />
                            <StatCard title="Mensajes Procesados" value={exec?.today?.messages ?? "—"} icon={Activity} color="#9b59b6" />
                            <StatCard title="Costo LLM Hoy" value={exec?.today?.llmCost ? `$${exec.today.llmCost.toFixed(4)}` : "$0.00"} icon={Zap} color="#f39c12" sub="USD" />
                        </div>
                        {exec?.models && exec.models.length > 0 && (
                            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
                                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Uso por Modelo LLM</h3>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {exec.models.map((m: any) => (
                                        <div key={m.model} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                            <span style={{ width: 120, fontSize: 13, color: "var(--text-secondary)" }}>{m.model}</span>
                                            <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--bg-tertiary)" }}>
                                                <div style={{ height: "100%", width: `${Math.min(100, m.requests)}%`, background: "var(--accent)", borderRadius: 3 }} />
                                            </div>
                                            <span style={{ fontSize: 13, fontWeight: 700, width: 40, textAlign: "right" }}>{m.requests}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );

            case "operativo":
                return (
                    <div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
                            <StatCard title="Tareas Vencidas" value={crm?.overdueTasks ?? "—"} icon={AlertTriangle} color="#e74c3c" />
                            <StatCard title="Etapas en Funnel" value={crm?.stageFunnel?.length ?? "—"} icon={BarChart2} color="#3498db" />
                            <StatCard title="Tareas Pendientes"
                                value={crm?.tasksByStatus?.find((t: any) => t.status === 'pending')?.count ?? "0"}
                                icon={CheckSquare} color="#f39c12" />
                        </div>
                        {crm?.stageFunnel && crm.stageFunnel.length > 0 && (
                            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
                                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Funnel de Leads por Etapa</h3>
                                {crm.stageFunnel.map((s: any) => (
                                    <div key={s.stage} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                                        <span style={{ width: 120, fontSize: 13, fontWeight: 600, color: STAGE_COLORS[s.stage] || "var(--text-primary)" }}>
                                            {s.stage}
                                        </span>
                                        <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--bg-tertiary)" }}>
                                            <div style={{ height: "100%", width: `${Math.min(100, parseInt(s.count) * 5)}%`, background: STAGE_COLORS[s.stage] || "var(--accent)", borderRadius: 4 }} />
                                        </div>
                                        <span style={{ fontSize: 13, fontWeight: 700, width: 32, textAlign: "right" }}>{s.count}</span>
                                        <span style={{ fontSize: 11, color: "var(--text-secondary)", width: 50 }}>
                                            Score: {parseFloat(s.avg_score || '0').toFixed(1)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );

            case "whatsapp":
                return (
                    <div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
                            <StatCard title="Mensajes Entrantes (7d)"
                                value={wa?.messageLast7d?.find((m: any) => m.direction === 'inbound')?.count ?? "0"}
                                icon={MessageSquare} color="#25D366" />
                            <StatCard title="Mensajes Salientes (7d)"
                                value={wa?.messageLast7d?.find((m: any) => m.direction === 'outbound')?.count ?? "0"}
                                icon={MessageSquare} color="#3498db" />
                            <StatCard title="Fallos de Entrega (7d)"
                                value={wa?.failedMessages ?? "0"} icon={AlertTriangle} color="#e74c3c" />
                        </div>
                        <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
                            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Estado del Canal</h3>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: wa?.failedMessages > 10 ? "#e74c3c" : "#2ecc71" }}>
                                <div style={{ width: 10, height: 10, borderRadius: "50%", background: wa?.failedMessages > 10 ? "#e74c3c" : "#2ecc71" }} />
                                {wa?.failedMessages > 10 ? "Tasa de errores alta — revisar calidad del número" : "Canal operando normalmente"}
                            </div>
                        </div>
                    </div>
                );

            case "ia":
                return (
                    <div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                            <StatCard title="Conversaciones (30d)" value={ai?.totalConversations ?? "—"} icon={MessageSquare} color="#9b59b6" />
                            <StatCard title="Handoffs" value={ai?.handoffs ?? "—"} icon={AlertTriangle} color="#e67e22" />
                            <StatCard title="Tasa de Handoff" value={ai?.handoffRate ? `${ai.handoffRate}%` : "—"} icon={TrendingUp} color="#3498db" />
                            <StatCard title="Score Promedio Lead" value={ai?.avgLeadScore ?? "—"} icon={BarChart2} color="#2ecc71" sub="/10" />
                        </div>
                        <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
                            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Salud del Agente IA</h3>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                {[
                                    { label: "Conversaciones resueltas", value: `${ai?.resolved ?? 0}` },
                                    { label: "Tasa resolución autónoma", value: ai?.handoffRate ? `${100 - ai.handoffRate}%` : "—" },
                                    { label: "Costo LLM hoy", value: `$${(ai?.llmCostToday || 0).toFixed(4)} USD` },
                                ].map(item => (
                                    <div key={item.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                                        <span style={{ color: "var(--text-secondary)" }}>{item.label}</span>
                                        <span style={{ fontWeight: 700 }}>{item.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );

            case "compliance":
                return (
                    <div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
                            <StatCard title="Total Consentimientos" value={compliance?.totalConsents ?? "—"} icon={Shield} color="#2ecc71" />
                            <StatCard title="Canales con OptOut"
                                value={compliance?.optOuts?.length ?? "0"} icon={AlertTriangle} color="#e74c3c" />
                            <StatCard title="OptOuts (últimos 7d)"
                                value={compliance?.optOuts?.reduce((a: number, o: any) => a + parseInt(o.last_7d || '0'), 0) ?? "0"}
                                icon={AlertTriangle} color="#e67e22" sub="últ. 7 días" />
                        </div>
                        {compliance?.optOuts?.length > 0 && (
                            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
                                <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Opt-Outs por Canal</h3>
                                {compliance.optOuts.map((o: any) => (
                                    <div key={o.channel} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                                        <span style={{ fontWeight: 600 }}>{o.channel}</span>
                                        <div style={{ display: "flex", gap: 20 }}>
                                            <span style={{ color: "var(--text-secondary)" }}>Total: <strong>{o.total}</strong></span>
                                            <span style={{ color: "#e74c3c" }}>Últimos 7d: <strong>{o.last_7d}</strong></span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );

            case "audit":
                return (
                    <div>
                        <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                                        {["Acción", "Recurso", "Actor", "IP", "Fecha"].map(h => (
                                            <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {auditLogs.length === 0 ? (
                                        <tr><td colSpan={5} style={{ padding: "30px 0", textAlign: "center", color: "var(--text-secondary)" }}>Sin registros de auditoría aún.</td></tr>
                                    ) : auditLogs.map((log: any) => (
                                        <tr key={log.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                            <td style={{ padding: "10px 16px" }}>
                                                <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "var(--bg-tertiary)", fontFamily: "monospace" }}>
                                                    {log.action}
                                                </span>
                                            </td>
                                            <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--text-secondary)" }}>{log.resource || "—"}</td>
                                            <td style={{ padding: "10px 16px", fontSize: 13 }}>{log.actor_name || log.user_id || "Sistema"}</td>
                                            <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-secondary)", fontFamily: "monospace" }}>{log.ip || "—"}</td>
                                            <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-secondary)" }}>
                                                {new Date(log.created_at).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );

            default: return null;
        }
    };

    return (
        <div>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Analytics & Compliance</h1>
                    <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 13 }}>
                        Vista operativa en tiempo real del sistema
                    </p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer", fontSize: 13 }}
                >
                    <RefreshCw size={14} style={{ animation: loading ? "spin 0.8s linear infinite" : "none" }} />
                    Actualizar
                </button>
            </div>

            {/* Tab Navigation */}
            <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "var(--bg-secondary)", borderRadius: 12, padding: 4, border: "1px solid var(--border)" }}>
                {TABS.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        style={{
                            flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                            background: activeTab === tab.key ? "var(--accent)" : "transparent",
                            color: activeTab === tab.key ? "white" : "var(--text-secondary)",
                            fontWeight: activeTab === tab.key ? 600 : 400, fontSize: 13,
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                            transition: "all 0.15s ease",
                        }}
                    >
                        <tab.icon size={13} /> {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {loading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, gap: 12, color: "var(--text-secondary)" }}>
                    <div style={{ width: 24, height: 24, border: "2px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    Cargando datos...
                </div>
            ) : renderTab()}
        </div>
    );
}
