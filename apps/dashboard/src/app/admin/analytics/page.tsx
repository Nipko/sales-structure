"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import {
    BarChart3, TrendingUp, Users, Megaphone, Zap, Target, ArrowRight
} from "lucide-react";

const stageLabels: Record<string, string> = {
    nuevo: "Nuevo", contactado: "Contactado", calificado: "Calificado",
    caliente: "Caliente", listo_cierre: "Listo p/ Cierre", ganado: "Ganado", perdido: "Perdido"
};
const stageColors: Record<string, string> = {
    nuevo: "#3498db", contactado: "#2ecc71", calificado: "#f39c12",
    caliente: "#e74c3c", listo_cierre: "#9b59b6", ganado: "#27ae60", perdido: "#95a5a6"
};

export default function AnalyticsV4Page() {
    const { activeTenantId } = useTenant();
    const [overview, setOverview] = useState<any>(null);
    const [funnel, setFunnel] = useState<any[]>([]);
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [crmStats, setCrmStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!activeTenantId) return;
        setLoading(true);
        const safeFetch = async (endpoint: string, fallback: any) => {
            try {
                return await api.fetch(endpoint);
            } catch {
                return fallback;
            }
        };

        Promise.all([
            safeFetch(`/analytics/crm/${activeTenantId}`, { data: null }),
            safeFetch(`/analytics/funnel/${activeTenantId}`, { data: [] }),
            safeFetch(`/analytics/campaigns/${activeTenantId}`, { data: [] }),
            safeFetch(`/analytics/dashboard/${activeTenantId}`, { data: null }),
        ]).then(([crm, fun, camp, dash]) => {
            setCrmStats(crm.data);
            setFunnel(fun.data || []);
            setCampaigns(camp.data || []);
            setOverview(dash.data);
            setLoading(false);
        });
    }, [activeTenantId]);

    const totalLeads = funnel.reduce((s, f) => s + (f.count || 0), 0);
    const wonLeads = funnel.find(f => f.stage === "ganado")?.count || 0;
    const lostLeads = funnel.find(f => f.stage === "perdido")?.count || 0;
    const globalConversion = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : "0";
    const maxFunnel = Math.max(...funnel.filter(f => f.stage !== "perdido").map(f => f.count || 0), 1);

    return (
        <div>
            {/* Header */}
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                    <BarChart3 size={28} color="var(--accent)" /> Analytics V4
                </h1>
                <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>Métricas ejecutivas, funnel de conversión y rendimiento por campaña</p>
            </div>

            {/* KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
                {[
                    { icon: Users, color: "#3498db", label: "Total Leads", value: totalLeads },
                    { icon: Target, color: "#2ecc71", label: "Ganados", value: wonLeads },
                    { icon: TrendingUp, color: "#f39c12", label: "Conversión", value: `${globalConversion}%` },
                    { icon: Zap, color: "#e74c3c", label: "Perdidos", value: lostLeads },
                    { icon: Megaphone, color: "#9b59b6", label: "Campañas", value: campaigns.length },
                ].map((kpi, i) => {
                    const Icon = kpi.icon;
                    return (
                        <div key={i} style={{ padding: "16px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-secondary)", display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: `${kpi.color}18` }}>
                                <Icon size={22} color={kpi.color} />
                            </div>
                            <div>
                                <div style={{ fontSize: 22, fontWeight: 700 }}>{kpi.value}</div>
                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{kpi.label}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Funnel */}
            <div style={{ padding: 20, borderRadius: 16, border: "1px solid var(--border)", background: "var(--bg-secondary)", marginBottom: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 16px" }}>📊 Funnel de Conversión</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {funnel.filter(f => f.stage !== "perdido").map((f, i) => {
                        const pct = maxFunnel > 0 ? (f.count / maxFunnel) * 100 : 0;
                        const color = stageColors[f.stage] || "#3498db";
                        return (
                            <div key={f.stage} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <div style={{ width: 120, fontSize: 13, fontWeight: 600, textAlign: "right", color: "var(--text-secondary)" }}>
                                    {stageLabels[f.stage] || f.stage}
                                </div>
                                <div style={{ flex: 1, height: 28, borderRadius: 6, background: "var(--bg-primary)", overflow: "hidden", position: "relative" }}>
                                    <div style={{
                                        width: `${Math.max(pct, 2)}%`, height: "100%", borderRadius: 6,
                                        background: `linear-gradient(90deg, ${color}cc, ${color})`,
                                        transition: "width 0.6s ease", display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 8
                                    }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: "white" }}>{f.count}</span>
                                    </div>
                                </div>
                                {i < funnel.filter(f2 => f2.stage !== "perdido").length - 1 && (
                                    <ArrowRight size={14} color="var(--text-secondary)" style={{ opacity: 0.3 }} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Campaign Analytics Table */}
            <div style={{ padding: 20, borderRadius: 16, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 16px" }}>📈 Rendimiento por Campaña</h2>
                {campaigns.length > 0 ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                            <tr style={{ borderBottom: "1px solid var(--border)" }}>
                                {["Campaña", "Estado", "Canal", "Leads", "Calificados", "Calientes", "Convertidos", "Score Prom.", "Conversión"].map(h => (
                                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "var(--text-secondary)", fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {campaigns.map(c => (
                                <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                    <td style={{ padding: "10px", fontWeight: 600 }}>{c.name}</td>
                                    <td style={{ padding: "10px" }}>
                                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: c.status === "active" ? "#2ecc7122" : "#95a5a622", color: c.status === "active" ? "#2ecc71" : "#95a5a6", fontWeight: 600 }}>{c.status}</span>
                                    </td>
                                    <td style={{ padding: "10px", color: "var(--text-secondary)" }}>{c.channel}</td>
                                    <td style={{ padding: "10px", fontWeight: 600 }}>{c.total_leads}</td>
                                    <td style={{ padding: "10px" }}>{c.qualified_leads}</td>
                                    <td style={{ padding: "10px", color: "#e74c3c", fontWeight: 600 }}>{c.hot_leads}</td>
                                    <td style={{ padding: "10px", color: "#2ecc71", fontWeight: 600 }}>{c.converted}</td>
                                    <td style={{ padding: "10px" }}>{c.avg_score || "—"}</td>
                                    <td style={{ padding: "10px", fontWeight: 700, color: parseFloat(c.conversion_rate) > 0 ? "#2ecc71" : "var(--text-secondary)" }}>{c.conversion_rate || 0}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
                        {loading ? "Cargando métricas..." : "No hay datos de campañas aún."}
                    </div>
                )}
            </div>

            {/* CRM Quick Stats */}
            {crmStats && (
                <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>Oportunidades Totales</div>
                        <div style={{ fontSize: 22, fontWeight: 700 }}>{crmStats.opportunities?.total || 0}</div>
                    </div>
                    <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>Valor Total Pipeline</div>
                        <div style={{ fontSize: 22, fontWeight: 700 }}>${(crmStats.opportunities?.totalValue || 0).toLocaleString()}</div>
                    </div>
                    <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>Win Rate</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: "#2ecc71" }}>{crmStats.opportunities?.winRate || 0}%</div>
                    </div>
                </div>
            )}
        </div>
    );
}
