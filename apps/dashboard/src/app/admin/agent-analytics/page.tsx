"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

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
    const t = useTranslations('analytics');
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
            <div className="grid grid-cols-4 gap-4 mb-6">
                {[
                    { title: "Conversaciones", value: totals.conversations ?? 0, color: "#3498db" },
                    { title: "Tiempo Resp. Promedio", value: totals.avgFirstResponse ?? "0s", color: "#f39c12" },
                    { title: "Tasa Resolucion", value: totals.resolved && totals.conversations ? `${Math.round((totals.resolved / totals.conversations) * 100)}%` : "0%", color: "#27ae60" },
                    { title: "CSAT Promedio", value: totals.csatAvg ? totals.csatAvg.toFixed(1) : "0.0", color: "#9b59b6" },
                ].map((card) => (
                    <div key={card.title} className="rounded-xl border border-border bg-[var(--bg-secondary)] px-5 py-[18px] flex flex-col gap-2">
                        <span className="text-xs text-[var(--text-secondary)] font-semibold uppercase tracking-wide">{card.title}</span>
                        <div className="text-[28px] font-semibold leading-none" style={{ color: card.color }}>{card.value}</div>
                    </div>
                ))}
            </div>

            {/* Daily Bar Chart */}
            <div className="rounded-xl border border-border bg-[var(--bg-secondary)] p-5">
                <h3 className="m-0 mb-4 text-[15px] font-semibold">Volumen Diario de Conversaciones</h3>
                {series.length === 0 ? (
                    <div className="text-center py-10 text-[var(--text-secondary)]">Sin datos para el rango seleccionado</div>
                ) : (
                    <div className="flex items-end gap-0.5 h-[180px] px-1">
                        {series.map((s: any, i: number) => {
                            const height = Math.max(2, (s.conversations / maxConv) * 160);
                            return (
                                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                    <span className="text-[10px] text-[var(--text-secondary)]">{s.conversations}</span>
                                    <div
                                        className="w-full max-w-6 rounded bg-[#3498db]"
                                        style={{ height, minHeight: 2 }}
                                    />
                                    {(i === 0 || i === series.length - 1 || i === Math.floor(series.length / 2)) && (
                                        <span className="text-[9px] text-[var(--text-secondary)] whitespace-nowrap">
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
            <div className="rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden">
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="border-b border-border">
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    onClick={() => handleSort(col.key)}
                                    className="px-4 py-3 text-left text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide cursor-pointer select-none"
                                >
                                    {col.label}
                                    {sortCol === col.key && (
                                        <span className="ml-1">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sortedAgents.length === 0 ? (
                            <tr><td colSpan={5} className="py-8 text-center text-[var(--text-secondary)]">Sin datos de agentes</td></tr>
                        ) : sortedAgents.map((agent: any) => (
                            <tr key={agent.agentId} className="border-b border-border">
                                <td className="px-4 py-2.5 font-semibold">{agent.agentName}</td>
                                <td className="px-4 py-2.5">{agent.totalConversations}</td>
                                <td className="px-4 py-2.5">{agent.resolvedConversations}</td>
                                <td className="px-4 py-2.5">{formatDuration(agent.avgFirstResponseSecs)}</td>
                                <td className="px-4 py-2.5">
                                    <span
                                        className={cn(
                                            "px-2 py-0.5 rounded text-xs font-semibold",
                                            agent.csatAvg >= 4
                                                ? "bg-[#27ae6020] text-[#27ae60]"
                                                : agent.csatAvg >= 3
                                                    ? "bg-[#f39c1220] text-[#f39c12]"
                                                    : "bg-[#e74c3c20] text-[#e74c3c]"
                                        )}
                                    >
                                        {agent.csatAvg ? agent.csatAvg.toFixed(1) : "\u2014"}
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
        <div className="grid grid-cols-3 gap-4">
            {channelsData.length === 0 ? (
                <div className="col-span-full text-center py-10 text-[var(--text-secondary)]">Sin datos de canales</div>
            ) : channelsData.map((ch: any) => {
                const color = CHANNEL_COLORS[ch.channel] || "#95a5a6";
                const label = CHANNEL_LABELS[ch.channel] || ch.channel;
                return (
                    <div key={ch.channel} className="rounded-xl border border-border bg-[var(--bg-secondary)] px-5 py-6 flex flex-col gap-3">
                        <div className="flex items-center gap-2.5">
                            <div
                                className="w-10 h-10 rounded-[10px] flex items-center justify-center text-lg font-semibold"
                                style={{ background: `${color}18`, color }}
                            >
                                {label[0]}
                            </div>
                            <div>
                                <div className="text-[15px] font-semibold">{label}</div>
                                <div className="text-xs text-[var(--text-secondary)]">{ch.percentage}% del total</div>
                            </div>
                        </div>
                        <div className="text-[32px] font-semibold" style={{ color }}>{ch.count}</div>
                        <div className="text-xs text-[var(--text-secondary)]">conversaciones</div>
                        {/* Percentage bar */}
                        <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)]">
                            <div className="h-full rounded-full" style={{ width: `${ch.percentage}%`, background: color }} />
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
                <div className="rounded-xl border border-border bg-[var(--bg-secondary)] px-6 py-8 text-center mb-6">
                    <div className="text-sm text-[var(--text-secondary)] font-semibold uppercase tracking-wide mb-2">
                        Promedio CSAT
                    </div>
                    <div
                        className="text-[56px] font-semibold"
                        style={{ color: avg >= 4 ? "#27ae60" : avg >= 3 ? "#f39c12" : "#e74c3c" }}
                    >
                        {avg ? avg.toFixed(1) : "\u2014"}
                    </div>
                    <div className="text-[13px] text-[var(--text-secondary)] mt-1">
                        {total} {total === 1 ? "respuesta" : "respuestas"}
                    </div>
                </div>

                {/* Rating Bars */}
                <div className="rounded-xl border border-border bg-[var(--bg-secondary)] p-5 mb-6">
                    <h3 className="m-0 mb-4 text-[15px] font-semibold">Distribucion por Estrellas</h3>
                    {[5, 4, 3, 2, 1].map((rating) => {
                        const count = dist[rating] || 0;
                        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                        return (
                            <div key={rating} className="flex items-center gap-3 mb-2.5">
                                <span className="w-6 text-sm font-semibold" style={{ color: ratingColors[rating] }}>{rating}</span>
                                <div className="flex-1 h-2 rounded bg-[var(--bg-tertiary)]">
                                    <div className="h-full rounded transition-[width] duration-300" style={{ width: `${pct}%`, background: ratingColors[rating] }} />
                                </div>
                                <span className="w-10 text-xs text-[var(--text-secondary)] text-right">{pct}%</span>
                                <span className="w-8 text-xs font-semibold text-right">{count}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Recent Feedback */}
                {feedback.length > 0 && (
                    <div className="rounded-xl border border-border bg-[var(--bg-secondary)] p-5">
                        <h3 className="m-0 mb-4 text-[15px] font-semibold">Feedback Reciente</h3>
                        <div className="flex flex-col gap-3">
                            {feedback.map((f: any) => (
                                <div key={f.id} className="p-3 rounded-lg border border-border bg-[var(--bg-primary)]">
                                    <div className="flex justify-between items-center mb-1.5">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-[13px]">{f.contactName}</span>
                                            <span className="text-[11px] text-[var(--text-secondary)]">/ {f.agentName}</span>
                                        </div>
                                        <span
                                            className="px-2 py-0.5 rounded text-xs font-semibold"
                                            style={{ background: `${ratingColors[f.rating]}20`, color: ratingColors[f.rating] }}
                                        >
                                            {f.rating}/5
                                        </span>
                                    </div>
                                    {f.feedback && (
                                        <p className="m-0 text-[13px] text-[var(--text-secondary)] italic">
                                            &quot;{f.feedback}&quot;
                                        </p>
                                    )}
                                    <div className="text-[11px] text-[var(--text-secondary)] mt-1.5">
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
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="m-0 text-[26px] font-semibold">{t('title')}</h1>
                    <p className="mt-1 mb-0 text-[var(--text-secondary)] text-[13px]">
                        Rendimiento de agentes y canales
                    </p>
                </div>
                {/* Date Range */}
                <div className="flex items-center gap-2">
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-border bg-[var(--bg-secondary)] text-foreground text-[13px]"
                    />
                    <span className="text-[var(--text-secondary)] text-[13px]">a</span>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-border bg-[var(--bg-secondary)] text-foreground text-[13px]"
                    />
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 bg-[var(--bg-secondary)] rounded-xl p-1 border border-border">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                            "flex-1 px-3 py-2 rounded-lg border-none cursor-pointer text-[13px] transition-all duration-150",
                            activeTab === tab.key
                                ? "bg-primary text-white font-semibold"
                                : "bg-transparent text-[var(--text-secondary)] font-normal"
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            {loading ? (
                <div className="flex items-center justify-center h-[300px] gap-3 text-[var(--text-secondary)]">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    Cargando datos...
                </div>
            ) : renderTab()}
        </div>
    );
}
