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

// Mock data (fallback when API has no data yet)
const mockStats = [
    { label: "Tenants Activos", value: "3", change: "+2 este mes", icon: Building2, color: "#6c5ce7" },
    { label: "Conversaciones Hoy", value: "127", change: "+34% vs ayer", icon: MessageSquare, color: "#00d68f" },
    { label: "Mensajes Procesados", value: "1,842", change: "Últimas 24h", icon: Activity, color: "#00b4d8" },
    { label: "Costo LLM Hoy", value: "$2.45", change: "-12% optimizado", icon: Brain, color: "#ffaa00" },
];

const mockActivity = [
    { tenant: "Gecko Aventura", event: "Nueva conversación iniciada", time: "Hace 2 min", type: "conversation" },
    { tenant: "Gecko Aventura", event: "Handoff a agente humano", time: "Hace 15 min", type: "handoff" },
    { tenant: "Demo Corp", event: "Documento RAG procesado", time: "Hace 1 hora", type: "knowledge" },
    { tenant: "Gecko Aventura", event: "Reserva confirmada #GK-0042", time: "Hace 2 horas", type: "order" },
    { tenant: "Test Tenant", event: "Persona config actualizada v3", time: "Hace 3 horas", type: "config" },
];

const mockModels = [
    { model: "Gemini Flash", tier: "Tier 3", requests: 842, pct: 46, color: "#00d68f" },
    { model: "GPT-4o-mini", tier: "Tier 2", requests: 534, pct: 29, color: "#00b4d8" },
    { model: "DeepSeek", tier: "Tier 4", requests: 312, pct: 17, color: "#ffaa00" },
    { model: "GPT-4o", tier: "Tier 1", requests: 154, pct: 8, color: "#6c5ce7" },
];

export default function AdminDashboard() {
    const { user } = useAuth();
    const [stats, setStats] = useState(mockStats);
    const [activity] = useState(mockActivity);
    const [modelUsage] = useState(mockModels);
    const [isLive, setIsLive] = useState(false);

    // Try to load real tenant count from API
    useEffect(() => {
        async function loadStats() {
            const tenantsResult = await api.getTenants();
            if (tenantsResult.success && tenantsResult.data) {
                const tenantCount = Array.isArray(tenantsResult.data)
                    ? tenantsResult.data.length
                    : typeof tenantsResult.data === "object" && "length" in (tenantsResult.data as any)
                        ? (tenantsResult.data as any).length
                        : 0;
                setStats(prev => prev.map(s =>
                    s.label === "Tenants Activos" ? { ...s, value: String(tenantCount) } : s
                ));
                setIsLive(true);
            }
        }
        loadStats();
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
                {stats.map((stat) => {
                    const Icon = stat.icon;
                    return (
                        <div key={stat.label} className="glass-card">
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
                                        {stat.value}
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
                                        {stat.change}
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
                        {activity.map((item, i) => (
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
                        ))}
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
                        {modelUsage.map((model) => (
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
                        ))}
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
