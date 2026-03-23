"use client";

import { useEffect, useState } from "react";
import {
    Building2,
    MessageSquare,
    Brain,
    TrendingUp,
    ArrowUpRight,
    Activity,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { DataSourceBadge } from "@/hooks/useApiData";

// Stat card config (icons + colors only — values come from API)
const statConfig = [
    { key: "leadsToday",        label: "Leads Hoy",            icon: Building2,     color: "#6c5ce7", suffix: "" },
    { key: "leadsHot",          label: "Leads Calientes 🔥",   icon: TrendingUp,    color: "#00d68f", suffix: "" },
    { key: "messagesProcessed", label: "Mensajes Procesados",  icon: Activity,      color: "#00b4d8", suffix: "" },
    { key: "llmCostToday",      label: "Costo LLM Hoy",        icon: Brain,         color: "#ffaa00", suffix: "$" },
];



export default function AdminDashboard() {
    const { user } = useAuth();
    const [overview, setOverview] = useState<Record<string, number>>({
        leadsToday: 0, leadsHot: 0, messagesProcessed: 0, llmCostToday: 0,
    });
    const [activity, setActivity] = useState<any[]>([]);
    const [modelUsage, setModelUsage] = useState<any[]>([]);
    const [isLive, setIsLive] = useState(false);

    useEffect(() => {
        async function loadOverview() {
            if (!user?.tenantId) return;

            const result = await api.getCommercialOverview(user.tenantId);
            if (result.success && result.data) {
                setOverview({
                    leadsToday:        result.data.leadsToday,
                    leadsHot:          result.data.leadsHot,
                    messagesProcessed: result.data.messagesProcessed,
                    llmCostToday:      result.data.llmCostToday,
                });
                setIsLive(true);
            }
            // Load dashboard details (activity + model usage)
            try {
                const dashResult = await api.getOverviewStats(user.tenantId);
                if (dashResult.success && dashResult.data) {
                    if (Array.isArray(dashResult.data.recentActivity)) {
                        setActivity(dashResult.data.recentActivity.map((a: any) => ({
                            tenant: a.tenant_name || a.tenant || 'Sistema',
                            event: a.event || a.description || a.event_type || '',
                            time: a.created_at ? new Date(a.created_at).toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit' }) : a.time || '',
                            type: a.type || a.event_type || 'conversation',
                        })));
                    }
                    if (Array.isArray(dashResult.data.modelUsage)) {
                        const total = dashResult.data.modelUsage.reduce((s: number, m: any) => s + (m.requests || m.count || 0), 0) || 1;
                        const modelColors = ['#00d68f', '#00b4d8', '#ffaa00', '#6c5ce7', '#e74c3c'];
                        setModelUsage(dashResult.data.modelUsage.map((m: any, i: number) => ({
                            model: m.model || m.llm_model || 'Unknown',
                            tier: m.tier || `Tier ${i + 1}`,
                            requests: m.requests || m.count || 0,
                            pct: Math.round(((m.requests || m.count || 0) / total) * 100),
                            color: modelColors[i % modelColors.length],
                        })));
                    }
                }
            } catch (err) {
                console.error('Failed to load dashboard details:', err);
            }
        }
        loadOverview();
    }, []);

    return (
        <div className="animate-in">
            {/* Header */}
            <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>
                        Dashboard
                    </h1>
                    <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                        Bienvenido, {user?.firstName || "Admin"} · Vista general de la plataforma
                    </p>
                </div>
                <DataSourceBadge isLive={isLive} />
            </div>

            {/* Stats Grid */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    gap: 20,
                    marginBottom: 32,
                }}
            >
                {statConfig.map((stat) => {
                    const Icon = stat.icon;
                    const rawValue = overview[stat.key] ?? 0;
                    const displayValue = stat.suffix === "$"
                        ? `$${rawValue.toFixed(2)}`
                        : rawValue.toLocaleString("es-CO");
                    return (
                        <div key={stat.key} className="glass-card">
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "flex-start",
                                }}
                            >
                                <div>
                                    <p
                                        style={{
                                            fontSize: 13,
                                            color: "var(--text-secondary)",
                                            margin: "0 0 8px",
                                        }}
                                    >
                                        {stat.label}
                                    </p>
                                    <p style={{ fontSize: 32, fontWeight: 800, margin: 0 }}>
                                        {displayValue}
                                    </p>
                                    <p
                                        style={{
                                            fontSize: 12,
                                            color: stat.color,
                                            margin: "8px 0 0",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 4,
                                        }}
                                    >
                                        <ArrowUpRight size={14} />
                                        {isLive ? "En vivo" : "Cargando..."}
                                    </p>
                                </div>
                                <div
                                    style={{
                                        width: 44,
                                        height: 44,
                                        borderRadius: 12,
                                        background: `${stat.color}15`,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    <Icon size={22} color={stat.color} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Two Column Layout */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 24,
                }}
            >
                {/* Recent Activity */}
                <div className="glass-card">
                    <h3
                        style={{
                            fontSize: 16,
                            fontWeight: 700,
                            margin: "0 0 20px",
                        }}
                    >
                        Actividad Reciente
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        {activity.length > 0 ? activity.map((item, i) => (
                            <div
                                key={i}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 14,
                                    padding: "10px 0",
                                    borderBottom:
                                        i < activity.length - 1
                                            ? "1px solid rgba(42,42,69,0.5)"
                                            : "none",
                                }}
                            >
                                <div
                                    style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: "50%",
                                        background:
                                            item.type === "conversation"
                                                ? "#00d68f"
                                                : item.type === "handoff"
                                                    ? "#ffaa00"
                                                    : item.type === "order"
                                                        ? "#6c5ce7"
                                                        : "#00b4d8",
                                        flexShrink: 0,
                                    }}
                                />
                                <div style={{ flex: 1 }}>
                                    <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>
                                        {item.event}
                                    </p>
                                    <p
                                        style={{
                                            margin: "2px 0 0",
                                            fontSize: 12,
                                            color: "var(--text-secondary)",
                                        }}
                                    >
                                        {item.tenant}
                                    </p>
                                </div>
                                <span
                                    style={{
                                        fontSize: 12,
                                        color: "var(--text-secondary)",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {item.time}
                                </span>
                            </div>
                        )) : (
                            <div style={{ padding: 20, textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>
                                No hay actividad reciente disponible
                            </div>
                        )}
                    </div>
                </div>

                {/* LLM Model Usage */}
                <div className="glass-card">
                    <h3
                        style={{
                            fontSize: 16,
                            fontWeight: 700,
                            margin: "0 0 20px",
                        }}
                    >
                        Distribución de Modelos LLM
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                        {modelUsage.length > 0 ? modelUsage.map((model) => (
                            <div key={model.model}>
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        marginBottom: 6,
                                    }}
                                >
                                    <span style={{ fontSize: 14, fontWeight: 500 }}>
                                        {model.model}{" "}
                                        <span
                                            style={{
                                                fontSize: 11,
                                                color: "var(--text-secondary)",
                                            }}
                                        >
                                            ({model.tier})
                                        </span>
                                    </span>
                                    <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                                        {model.requests} req · {model.pct}%
                                    </span>
                                </div>
                                <div
                                    style={{
                                        height: 6,
                                        background: "var(--bg-primary)",
                                        borderRadius: 3,
                                        overflow: "hidden",
                                    }}
                                >
                                    <div
                                        style={{
                                            height: "100%",
                                            width: `${model.pct}%`,
                                            background: model.color,
                                            borderRadius: 3,
                                            transition: "width 1s ease",
                                        }}
                                    />
                                </div>
                            </div>
                        )) : (
                            <div style={{ padding: 20, textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>
                                Sin datos de uso de modelos disponibles
                            </div>
                        )}
                    </div>
                    <div
                        style={{
                            marginTop: 20,
                            padding: "12px 16px",
                            background: "var(--bg-primary)",
                            borderRadius: 10,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                        }}
                    >
                        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                            <TrendingUp
                                size={14}
                                style={{ marginRight: 6, verticalAlign: "middle" }}
                            />
                            El Router ahorra ~42% en costos usando Tier 3-4 para mensajes simples
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
