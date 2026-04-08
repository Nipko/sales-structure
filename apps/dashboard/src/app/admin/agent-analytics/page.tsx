"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";

const TABS = [
    { key: "overview", label: "Overview" },
    { key: "agentes", label: "Agentes" },
    { key: "canales", label: "Canales" },
    { key: "csat", label: "CSAT" },
];

const CHANNEL_COLORS: Record<string, string> = {
    whatsapp: "#25D366",
    instagram: "#E1306C",
    messenger: "#0084FF",
    telegram: "#0088CC",
    email: "#EA4335",
    web: "#4285F4",
};

const CHANNEL_LABELS: Record<string, string> = {
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    messenger: "Messenger",
    telegram: "Telegram",
    email: "Email",
    web: "Web",
};

function formatDate(d: Date): string {
    return d.toISOString().split("T")[0];
}

function formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return "0s";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

type SortDir = "asc" | "desc";

export default function AgentAnalyticsPage() {
    const { activeTenantId } = useTenant();
    const [activeTab, setActiveTab] = useState("overview");
    const [loading, setLoading] = useState(false);

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [startDate, setStartDate] = useState(formatDate(thirtyDaysAgo));
    const [endDate, setEndDate] = useState(formatDate(now));

    const [overviewData, setOverviewData] = useState<any>(null);
    const [agentsData, setAgentsData] = useState<any[]>([]);
    const [channelsData, setChannelsData] = useState<any[]>([]);
    const [csatData, setCsatData] = useState<any>(null);

    const [sortCol, setSortCol] = useState<string>("resolvedConversations");
    const [sortDir, setSortDir] = useState<SortDir>("desc");

    const tenantId = activeTenantId;

    const load = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const [d1, d2, d3, d4] = await Promise.all([
                api.fetch(`/agent-analytics/${tenantId}/overview-series?start=${startDate}&end=${endDate}`),
                api.fetch(`/agent-analytics/${tenantId}/performance?start=${startDate}&end=${endDate}`),
                api.fetch(`/agent-analytics/${tenantId}/channels?start=${startDate}&end=${endDate}`),
                api.fetch(`/agent-analytics/${tenantId}/csat?start=${startDate}&end=${endDate}`),
            ]);
            setOverviewData(d1.data);
            setAgentsData(Array.isArray(d2.data) ? d2.data : []);
            setChannelsData(Array.isArray(d3.data) ? d3.data : []);
            setCsatData(d4.data);
        } catch (e) {
            console.error("Error loading agent analytics:", e);
        } finally {
            setLoading(false);
        }
    }, [tenantId, startDate, endDate]);

    useEffect(() => { load(); }, [load]);

    const handleSort = (col: string) => {
        if (sortCol === col) {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
        } else {
            setSortCol(col);
            setSortDir("desc");
        }
    };

    const sortedAgents = useMemo(() => {
        const list = [...agentsData];
        list.sort((a, b) => {
            const av = a[sortCol] ?? 0;
            const bv = b[sortCol] ?? 0;
            if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
            return sortDir === "asc" ? av - bv : bv - av;
        });
        return list;
    }, [agentsData, sortCol, sortDir]);

    const totals = overviewData?.totals || {};
    const series = overviewData?.series || [];
    const maxConv = Math.max(1, ...series.map((s: any) => s.conversations || 0));

    const renderOverview = () => (
        <div>
            {/* KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                {[
                    { title: "Conversaciones", value: totals.conversations ?? 0, color: "#3498db" },
                    { title: "Tiempo Resp. Promedio", value: totals.avgFirstResponse ?? "0s", color: "#f39c12" },
                    { title: "Tasa Resolución", value: totals.resolved && totals.conversations ? `${Math.round((totals.resolved / totals.conversations) * 100)}%` : "0%", color: "#27ae60" },
                    { title: "CSAT Promedio", value: totals.csatAvg ? totals.csatAvg.toFixed(1) : "0.0", color: "#9b59b6" },
                ].map((card) => (
                    <div key={card.title} style={{
                        background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)",
                        padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8,
                    }}>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{card.title}</span>
                        <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: card.color }}>{card.value}</div>
                    </div>
                ))}
            </div>

            {/* Daily Bar Chart */}
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Volumen Diario de Conversaciones</h3>
                {series.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>Sin datos para el rango seleccionado</div>
                ) : (
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 180, padding: "0 4px" }}>
                        {series.map((s: any, i: number) => {
                            const height = Math.max(2, (s.conversations / maxConv) * 160);
                            return (
                                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                                    <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{s.conversations}</span>
                                    <div style={{
                                        width: "100%", maxWidth: 24, height, borderRadius: 4,
                                        background: "#3498db", minHeight: 2,
                                    }} />
                                    {(i === 0 || i === series.length - 1 || i === Math.floor(series.length / 2)) && (
                                        <span style={{ fontSize: 9, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                                            {s.date?.slice(5)}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );

    const renderAgentes = () => {
        const columns: { key: string; label: string }[] = [
            { key: "agentName", label: "Agente" },
            { key: "totalConversations", label: "Conversaciones" },
            { key: "resolvedConversations", label: "Resueltas" },
            { key: "avgFirstResponseSecs", label: "Tiempo Resp." },
            { key: "csatAvg", label: "CSAT" },
        ];

        return (
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    onClick={() => handleSort(col.key)}
                                    style={{
                                        padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600,
                                        color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5,
                                        cursor: "pointer", userSelect: "none",
                                    }}
                                >
                                    {col.label}
                                    {sortCol === col.key && (
                                        <span style={{ marginLeft: 4 }}>{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sortedAgents.length === 0 ? (
                            <tr><td colSpan={5} style={{ padding: "30px 0", textAlign: "center", color: "var(--text-secondary)" }}>Sin datos de agentes</td></tr>
                        ) : sortedAgents.map((agent: any) => (
                            <tr key={agent.agentId} style={{ borderBottom: "1px solid var(--border)" }}>
                                <td style={{ padding: "10px 16px", fontWeight: 600 }}>{agent.agentName}</td>
                                <td style={{ padding: "10px 16px" }}>{agent.totalConversations}</td>
                                <td style={{ padding: "10px 16px" }}>{agent.resolvedConversations}</td>
                                <td style={{ padding: "10px 16px" }}>{formatDuration(agent.avgFirstResponseSecs)}</td>
                                <td style={{ padding: "10px 16px" }}>
                                    <span style={{
                                        padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700,
                                        background: agent.csatAvg >= 4 ? "#27ae6020" : agent.csatAvg >= 3 ? "#f39c1220" : "#e74c3c20",
                                        color: agent.csatAvg >= 4 ? "#27ae60" : agent.csatAvg >= 3 ? "#f39c12" : "#e74c3c",
                                    }}>
                                        {agent.csatAvg ? agent.csatAvg.toFixed(1) : "—"}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    const renderCanales = () => (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {channelsData.length === 0 ? (
                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>Sin datos de canales</div>
            ) : channelsData.map((ch: any) => {
                const color = CHANNEL_COLORS[ch.channel] || "#95a5a6";
                const label = CHANNEL_LABELS[ch.channel] || ch.channel;
                return (
                    <div key={ch.channel} style={{
                        background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)",
                        padding: "24px 20px", display: "flex", flexDirection: "column", gap: 12,
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{
                                width: 40, height: 40, borderRadius: 10, background: `${color}18`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 18, fontWeight: 800, color,
                            }}>
                                {label[0]}
                            </div>
                            <div>
                                <div style={{ fontSize: 15, fontWeight: 700 }}>{label}</div>
                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{ch.percentage}% del total</div>
                            </div>
                        </div>
                        <div style={{ fontSize: 32, fontWeight: 800, color }}>{ch.count}</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>conversaciones</div>
                        {/* Percentage bar */}
                        <div style={{ height: 6, borderRadius: 3, background: "var(--bg-tertiary)" }}>
                            <div style={{ height: "100%", width: `${ch.percentage}%`, background: color, borderRadius: 3 }} />
                        </div>
                    </div>
                );
            })}
        </div>
    );

    const renderCSAT = () => {
        const dist = csatData?.distribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        const total = csatData?.total || 0;
        const avg = csatData?.average || 0;
        const feedback = csatData?.recentFeedback || [];

        const ratingColors: Record<number, string> = { 1: "#e74c3c", 2: "#e67e22", 3: "#f39c12", 4: "#2ecc71", 5: "#27ae60" };

        return (
            <div>
                {/* Big Average */}
                <div style={{
                    background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)",
                    padding: "32px 24px", textAlign: "center", marginBottom: 24,
                }}>
                    <div style={{ fontSize: 14, color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                        Promedio CSAT
                    </div>
                    <div style={{ fontSize: 56, fontWeight: 800, color: avg >= 4 ? "#27ae60" : avg >= 3 ? "#f39c12" : "#e74c3c" }}>
                        {avg ? avg.toFixed(1) : "—"}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                        {total} {total === 1 ? "respuesta" : "respuestas"}
                    </div>
                </div>

                {/* Rating Bars */}
                <div style={{
                    background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)",
                    padding: 20, marginBottom: 24,
                }}>
                    <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Distribucion por Estrellas</h3>
                    {[5, 4, 3, 2, 1].map((rating) => {
                        const count = dist[rating] || 0;
                        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                        return (
                            <div key={rating} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                                <span style={{ width: 24, fontSize: 14, fontWeight: 700, color: ratingColors[rating] }}>{rating}</span>
                                <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--bg-tertiary)" }}>
                                    <div style={{ height: "100%", width: `${pct}%`, background: ratingColors[rating], borderRadius: 4, transition: "width 0.3s" }} />
                                </div>
                                <span style={{ width: 40, fontSize: 12, color: "var(--text-secondary)", textAlign: "right" }}>{pct}%</span>
                                <span style={{ width: 32, fontSize: 12, fontWeight: 700, textAlign: "right" }}>{count}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Recent Feedback */}
                {feedback.length > 0 && (
                    <div style={{
                        background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)",
                        padding: 20,
                    }}>
                        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Feedback Reciente</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {feedback.map((f: any) => (
                                <div key={f.id} style={{
                                    padding: 12, borderRadius: 8, border: "1px solid var(--border)",
                                    background: "var(--bg-primary)",
                                }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{ fontWeight: 600, fontSize: 13 }}>{f.contactName}</span>
                                            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>/ {f.agentName}</span>
                                        </div>
                                        <span style={{
                                            padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700,
                                            background: `${ratingColors[f.rating]}20`, color: ratingColors[f.rating],
                                        }}>
                                            {f.rating}/5
                                        </span>
                                    </div>
                                    {f.feedback && (
                                        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
                                            &quot;{f.feedback}&quot;
                                        </p>
                                    )}
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6 }}>
                                        {new Date(f.createdAt).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderTab = () => {
        switch (activeTab) {
            case "overview": return renderOverview();
            case "agentes": return renderAgentes();
            case "canales": return renderCanales();
            case "csat": return renderCSAT();
            default: return null;
        }
    };

    return (
        <div>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Agent Analytics</h1>
                    <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 13 }}>
                        Rendimiento de agentes y canales
                    </p>
                </div>
                {/* Date Range */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        style={{
                            padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)",
                            background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 13,
                        }}
                    />
                    <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>a</span>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        style={{
                            padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)",
                            background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 13,
                        }}
                    />
                </div>
            </div>

            {/* Tabs */}
            <div style={{
                display: "flex", gap: 4, marginBottom: 24, background: "var(--bg-secondary)",
                borderRadius: 12, padding: 4, border: "1px solid var(--border)",
            }}>
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        style={{
                            flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                            background: activeTab === tab.key ? "var(--accent)" : "transparent",
                            color: activeTab === tab.key ? "white" : "var(--text-secondary)",
                            fontWeight: activeTab === tab.key ? 600 : 400, fontSize: 13,
                            transition: "all 0.15s ease",
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            {loading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, gap: 12, color: "var(--text-secondary)" }}>
                    <div style={{ width: 24, height: 24, border: "2px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    Cargando datos...
                </div>
            ) : renderTab()}
        </div>
    );
}
