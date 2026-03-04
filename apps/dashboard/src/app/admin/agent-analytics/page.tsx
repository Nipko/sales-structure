"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import {
    BarChart3,
    Clock,
    CheckCircle,
    Users,
    Star,
    TrendingUp,
    TrendingDown,
    MessageSquare,
    Award,
    Zap,
    ThumbsUp,
    ThumbsDown,
    Minus,
} from "lucide-react";

// ============================================
// MOCK DATA
// ============================================

const mockOverview = {
    totalConversations: 342,
    resolvedToday: 18,
    avgResponseTime: "3m 28s",
    avgResolutionTime: "14m 52s",
    csatAvg: 4.6,
    csatTrend: 8.2,
    activeAgents: 3,
    handoffRate: 0.12,
};

const mockAgents = [
    { agentName: "Sofia IA", totalConversations: 245, resolvedConversations: 238, activeConversations: 7, avgFirstResponseSecs: 2, avgResolutionSecs: 180, csatAvg: 4.8, csatCount: 120, messagesHandled: 1450, isAI: true },
    { agentName: "Admin", totalConversations: 52, resolvedConversations: 48, activeConversations: 4, avgFirstResponseSecs: 195, avgResolutionSecs: 1320, csatAvg: 4.5, csatCount: 35, messagesHandled: 310, isAI: false },
    { agentName: "Carlos Guía", totalConversations: 28, resolvedConversations: 25, activeConversations: 3, avgFirstResponseSecs: 320, avgResolutionSecs: 2100, csatAvg: 4.7, csatCount: 20, messagesHandled: 156, isAI: false },
    { agentName: "María Ventas", totalConversations: 17, resolvedConversations: 15, activeConversations: 2, avgFirstResponseSecs: 240, avgResolutionSecs: 900, csatAvg: 4.3, csatCount: 12, messagesHandled: 98, isAI: false },
];

const mockCSAT: Record<number, number> = { 5: 87, 4: 42, 3: 12, 2: 3, 1: 1 };

const mockCSATRecent = [
    { contactName: "Carlos Medina", agentName: "Sofia IA", rating: 5, feedback: "Excelente atención, muy rápida!", createdAt: "Hace 1 hora" },
    { contactName: "Ana García", agentName: "Admin", rating: 4, feedback: "Buena info pero tardó un poco", createdAt: "Hace 3 horas" },
    { contactName: "Luis Rodríguez", agentName: "Carlos Guía", rating: 5, feedback: null, createdAt: "Hace 5 horas" },
    { contactName: "María Pérez", agentName: "Sofia IA", rating: 5, feedback: "¡La mejor!", createdAt: "Ayer" },
    { contactName: "Pedro Sánchez", agentName: "María Ventas", rating: 3, feedback: "No resolvió mi duda completamente", createdAt: "Ayer" },
];

const formatTime = (secs: number) => {
    if (secs < 60) return `${Math.round(secs)}s`;
    if (secs < 3600) return `${Math.round(secs / 60)}m`;
    return `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;
};

const starColors = ["", "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#27ae60"];

type TabType = "overview" | "agents" | "csat";

export default function AgentAnalyticsPage() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<TabType>("overview");
    const [overview, setOverview] = useState(mockOverview);
    const [agents, setAgents] = useState(mockAgents);
    const [csatData, setCsatData] = useState(mockCSAT);
    const [csatRecent, setCsatRecent] = useState(mockCSATRecent);
    const [isLive, setIsLive] = useState(false);

    // Load analytics from API
    useEffect(() => {
        async function load() {
            if (!user?.tenantId) return;
            const [overviewRes, agentsRes, csatRes] = await Promise.all([
                api.getOverviewStats(user.tenantId),
                api.getAgentLeaderboard(user.tenantId),
                api.getCSATResponses(user.tenantId),
            ]);
            if (overviewRes.success && overviewRes.data) { setOverview(overviewRes.data as any); setIsLive(true); }
            if (agentsRes.success && Array.isArray(agentsRes.data)) setAgents(agentsRes.data as any);
            if (csatRes.success && Array.isArray(csatRes.data)) setCsatRecent(csatRes.data as any);
        }
        load();
    }, [user?.tenantId]);

    const csatTotal = Object.values(csatData).reduce((a, b) => a + b, 0);
    const csatMaxBar = Math.max(...Object.values(csatData));

    return (
        <div>
            {/* Header */}
            <div style={{ marginBottom: 20 }}>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                    <BarChart3 size={28} color="var(--accent)" />
                    Analytics de Agentes
                    <DataSourceBadge isLive={isLive} />
                </h1>
                <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                    Performance en tiempo real · CSAT · Métricas de equipo
                </p>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
                {([
                    { key: "overview" as const, label: "Resumen", icon: BarChart3 },
                    { key: "agents" as const, label: "Leaderboard", icon: Award },
                    { key: "csat" as const, label: "CSAT", icon: Star },
                ] as const).map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        style={{
                            padding: "10px 20px", border: "none", cursor: "pointer",
                            fontSize: 14, fontWeight: activeTab === tab.key ? 600 : 400,
                            color: activeTab === tab.key ? "var(--accent)" : "var(--text-secondary)",
                            background: "transparent",
                            borderBottom: activeTab === tab.key ? "2px solid var(--accent)" : "2px solid transparent",
                            display: "flex", alignItems: "center", gap: 6, marginBottom: -1,
                        }}
                    >
                        <tab.icon size={16} /> {tab.label}
                    </button>
                ))}
            </div>

            {/* ============================================ */}
            {/* OVERVIEW TAB */}
            {/* ============================================ */}
            {activeTab === "overview" && (
                <div>
                    {/* Stats Grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
                        {[
                            { icon: MessageSquare, label: "Conversaciones", value: String(overview.totalConversations), color: "#3498db", sub: `${overview.resolvedToday} resueltas hoy` },
                            { icon: Clock, label: "Tiempo de respuesta", value: overview.avgResponseTime, color: "#e67e22", sub: "Promedio primera respuesta" },
                            { icon: CheckCircle, label: "Resolución", value: overview.avgResolutionTime, color: "#2ecc71", sub: "Promedio de resolución" },
                            { icon: Star, label: "CSAT Promedio", value: overview.csatAvg.toFixed(1), color: "#f1c40f", sub: `${overview.csatTrend > 0 ? "↑" : "↓"} ${Math.abs(overview.csatTrend).toFixed(1)}% esta semana` },
                        ].map(card => (
                            <div key={card.label} style={{
                                padding: "16px", borderRadius: 14, border: "1px solid var(--border)",
                                background: "var(--bg-secondary)",
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                    <div style={{
                                        width: 40, height: 40, borderRadius: 10, display: "flex",
                                        alignItems: "center", justifyContent: "center", background: `${card.color}22`,
                                    }}>
                                        <card.icon size={20} color={card.color} />
                                    </div>
                                </div>
                                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 10 }}>{card.value}</div>
                                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{card.label}</div>
                                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4, opacity: 0.7 }}>{card.sub}</div>
                            </div>
                        ))}
                    </div>

                    {/* Additional Stats Row */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                        <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>Agentes activos</div>
                            <div style={{ fontSize: 32, fontWeight: 700 }}>{overview.activeAgents}</div>
                            <div style={{ fontSize: 12, color: "#2ecc71", display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                                <Users size={14} /> Con conversaciones abiertas
                            </div>
                        </div>
                        <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>Tasa de handoff IA→Humano</div>
                            <div style={{ fontSize: 32, fontWeight: 700 }}>{(overview.handoffRate * 100).toFixed(0)}%</div>
                            <div style={{ fontSize: 12, color: "#e67e22", display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                                <Zap size={14} /> {Math.round(overview.totalConversations * overview.handoffRate)} handoffs totales
                            </div>
                        </div>
                        <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>Resolución por IA</div>
                            <div style={{ fontSize: 32, fontWeight: 700 }}>{(100 - overview.handoffRate * 100).toFixed(0)}%</div>
                            <div style={{ fontSize: 12, color: "#9b59b6", display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                                <TrendingUp size={14} /> Sin intervención humana
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ============================================ */}
            {/* AGENTS TAB */}
            {/* ============================================ */}
            {activeTab === "agents" && (
                <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: "1px solid var(--border)" }}>
                                {["#", "Agente", "Resueltas", "Activas", "Resp. promedio", "Resolución", "CSAT", "Mensajes"].map(h => (
                                    <th key={h} style={{
                                        padding: "12px 14px", textAlign: "left", fontSize: 12, fontWeight: 600,
                                        color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5,
                                    }}>
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {agents.map((agent, i) => (
                                <tr
                                    key={agent.agentName}
                                    style={{ borderBottom: "1px solid var(--border)" }}
                                    onMouseOver={e => (e.currentTarget.style.background = "var(--bg-tertiary)")}
                                    onMouseOut={e => (e.currentTarget.style.background = "transparent")}
                                >
                                    <td style={{ padding: "14px", width: 50 }}>
                                        <span style={{
                                            width: 28, height: 28, borderRadius: "50%", display: "inline-flex",
                                            alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13,
                                            background: i === 0 ? "linear-gradient(135deg, #f1c40f, #e67e22)" : "var(--bg-tertiary)",
                                            color: i === 0 ? "white" : "var(--text-secondary)",
                                        }}>
                                            {i + 1}
                                        </span>
                                    </td>
                                    <td style={{ padding: "14px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            <div style={{
                                                width: 36, height: 36, borderRadius: "50%",
                                                background: agent.isAI ? "linear-gradient(135deg, var(--accent), #9b59b6)" : "linear-gradient(135deg, #2ecc71, #27ae60)",
                                                display: "flex", alignItems: "center", justifyContent: "center",
                                                color: "white", fontWeight: 700, fontSize: 14,
                                            }}>
                                                {agent.agentName.charAt(0)}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: 14 }}>{agent.agentName}</div>
                                                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                                                    {agent.isAI ? "🤖 Inteligencia Artificial" : "👤 Agente humano"}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: "14px", fontWeight: 600, fontSize: 15 }}>{agent.resolvedConversations}</td>
                                    <td style={{ padding: "14px" }}>
                                        <span style={{
                                            padding: "3px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                                            background: agent.activeConversations > 5 ? "rgba(231, 76, 60, 0.15)" : "rgba(46, 204, 113, 0.15)",
                                            color: agent.activeConversations > 5 ? "#e74c3c" : "#2ecc71",
                                        }}>
                                            {agent.activeConversations}
                                        </span>
                                    </td>
                                    <td style={{ padding: "14px", fontSize: 14 }}>{formatTime(agent.avgFirstResponseSecs)}</td>
                                    <td style={{ padding: "14px", fontSize: 14 }}>{formatTime(agent.avgResolutionSecs)}</td>
                                    <td style={{ padding: "14px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <Star size={14} color="#f1c40f" fill="#f1c40f" />
                                            <span style={{ fontWeight: 600, fontSize: 14 }}>{agent.csatAvg.toFixed(1)}</span>
                                            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>({agent.csatCount})</span>
                                        </div>
                                    </td>
                                    <td style={{ padding: "14px", fontSize: 14, color: "var(--text-secondary)" }}>{agent.messagesHandled}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ============================================ */}
            {/* CSAT TAB */}
            {/* ============================================ */}
            {activeTab === "csat" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    {/* Left: Distribution */}
                    <div style={{ padding: 20, borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Distribución de calificaciones</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {[5, 4, 3, 2, 1].map(rating => {
                                const count = csatData[rating] || 0;
                                const pct = csatTotal > 0 ? (count / csatTotal * 100) : 0;
                                return (
                                    <div key={rating} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <div style={{ width: 60, display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                                            {Array(rating).fill(0).map((_, i) => (
                                                <Star key={i} size={12} color={starColors[rating]} fill={starColors[rating]} />
                                            ))}
                                        </div>
                                        <div style={{ flex: 1, height: 24, borderRadius: 6, background: "var(--bg-tertiary)", overflow: "hidden" }}>
                                            <div style={{
                                                height: "100%", borderRadius: 6,
                                                width: `${csatMaxBar > 0 ? (count / csatMaxBar * 100) : 0}%`,
                                                background: `${starColors[rating]}cc`,
                                                transition: "width 0.5s ease",
                                                display: "flex", alignItems: "center", paddingLeft: 8,
                                            }}>
                                                {count > 5 && <span style={{ fontSize: 11, color: "white", fontWeight: 600 }}>{count}</span>}
                                            </div>
                                        </div>
                                        <span style={{ width: 50, textAlign: "right", fontSize: 13, color: "var(--text-secondary)" }}>
                                            {pct.toFixed(0)}%
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Summary */}
                        <div style={{
                            marginTop: 20, padding: 14, borderRadius: 10,
                            background: "var(--bg-tertiary)", textAlign: "center",
                        }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                                <Star size={24} color="#f1c40f" fill="#f1c40f" />
                                <span style={{ fontSize: 36, fontWeight: 700 }}>{overview.csatAvg.toFixed(1)}</span>
                            </div>
                            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                                de {csatTotal} respuestas
                            </div>
                        </div>
                    </div>

                    {/* Right: Recent Responses */}
                    <div style={{ padding: 20, borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Respuestas recientes</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {csatRecent.map((entry, i) => (
                                <div key={i} style={{
                                    padding: "12px", borderRadius: 10, background: "var(--bg-primary)",
                                    border: "1px solid var(--border)",
                                }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <div style={{
                                                width: 32, height: 32, borderRadius: "50%",
                                                background: "linear-gradient(135deg, var(--accent), #9b59b6)",
                                                display: "flex", alignItems: "center", justifyContent: "center",
                                                color: "white", fontWeight: 700, fontSize: 12,
                                            }}>
                                                {entry.contactName.charAt(0)}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.contactName}</div>
                                                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Atendido por {entry.agentName}</div>
                                            </div>
                                        </div>
                                        <div style={{ display: "flex", gap: 2 }}>
                                            {Array(5).fill(0).map((_, j) => (
                                                <Star key={j} size={14}
                                                    color={j < entry.rating ? "#f1c40f" : "var(--border)"}
                                                    fill={j < entry.rating ? "#f1c40f" : "none"} />
                                            ))}
                                        </div>
                                    </div>
                                    {entry.feedback && (
                                        <div style={{
                                            marginTop: 8, padding: "6px 10px", borderRadius: 6,
                                            background: "var(--bg-tertiary)", fontSize: 13,
                                            color: "var(--text-secondary)", fontStyle: "italic",
                                        }}>
                                            &ldquo;{entry.feedback}&rdquo;
                                        </div>
                                    )}
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6, textAlign: "right" }}>
                                        {entry.createdAt}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
