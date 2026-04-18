"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import {
    BarChart3, TrendingUp, Users, Megaphone, Zap, Target, ArrowRight
} from "lucide-react";

const stageLabels: Record<string, string> = {
    nuevo: "New", contactado: "Contacted", calificado: "Qualified",
    caliente: "Hot", listo_cierre: "Ready to close", ganado: "Won", perdido: "Lost"
};
const stageColors: Record<string, string> = {
    nuevo: "#3498db", contactado: "#2ecc71", calificado: "#f39c12",
    caliente: "#e74c3c", listo_cierre: "#9b59b6", ganado: "#27ae60", perdido: "#95a5a6"
};

export default function AnalyticsV4Page() {
    const tc = useTranslations("common");
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
            <PageHeader title="Analytics" icon={BarChart3} />

            {/* KPI Cards */}
            <div className="grid grid-cols-5 gap-3 mb-6">
                {[
                    { icon: Users, color: "#3498db", label: "Total Leads", value: totalLeads },
                    { icon: Target, color: "#2ecc71", label: "Ganados", value: wonLeads },
                    { icon: TrendingUp, color: "#f39c12", label: "Conversion", value: `${globalConversion}%` },
                    { icon: Zap, color: "#e74c3c", label: "Lost", value: lostLeads },
                    { icon: Megaphone, color: "#9b59b6", label: "Campaigns", value: campaigns.length },
                ].map((kpi, i) => {
                    const Icon = kpi.icon;
                    return (
                        <div key={i} className="p-4 rounded-[14px] border border-border bg-card flex items-center gap-3">
                            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${kpi.color}18` }}>
                                <Icon size={22} color={kpi.color} />
                            </div>
                            <div>
                                <div className="text-[22px] font-semibold">{kpi.value}</div>
                                <div className="text-xs text-muted-foreground">{kpi.label}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Funnel */}
            <div className="p-5 rounded-xl border border-border bg-card mb-6">
                <h2 className="text-base font-semibold mb-4">📊 Funnel de Conversion</h2>
                <div className="flex flex-col gap-2">
                    {funnel.filter(f => f.stage !== "perdido").map((f, i) => {
                        const pct = maxFunnel > 0 ? (f.count / maxFunnel) * 100 : 0;
                        const color = stageColors[f.stage] || "#3498db";
                        return (
                            <div key={f.stage} className="flex items-center gap-3">
                                <div className="w-[120px] text-[13px] font-semibold text-right text-muted-foreground">
                                    {stageLabels[f.stage] || f.stage}
                                </div>
                                <div className="flex-1 h-7 rounded-md bg-background overflow-hidden relative">
                                    <div
                                        className="h-full rounded-md flex items-center justify-end pr-2 transition-[width] duration-[600ms]"
                                        style={{
                                            width: `${Math.max(pct, 2)}%`,
                                            background: `linear-gradient(90deg, ${color}cc, ${color})`,
                                        }}
                                    >
                                        <span className="text-xs font-semibold text-white">{f.count}</span>
                                    </div>
                                </div>
                                {i < funnel.filter(f2 => f2.stage !== "perdido").length - 1 && (
                                    <ArrowRight size={14} className="text-muted-foreground opacity-30" />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Campaign Analytics Table */}
            <div className="p-5 rounded-xl border border-border bg-card">
                <h2 className="text-base font-semibold mb-4">📈 Rendimiento por Campana</h2>
                {campaigns.length > 0 ? (
                    <table className="w-full border-collapse text-[13px]">
                        <thead>
                            <tr className="border-b border-border">
                                {["Campaign", "Status", "Channel", "Leads", "Qualified", "Hot", "Converted", "Avg Score", "Conversion"].map(h => (
                                    <th key={h} className="px-2.5 py-2 text-left font-semibold text-muted-foreground text-[11px] uppercase">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {campaigns.map(c => (
                                <tr key={c.id} className="border-b border-border">
                                    <td className="p-2.5 font-semibold">{c.name}</td>
                                    <td className="p-2.5">
                                        <span
                                            className="text-[10px] px-2 py-0.5 rounded-md font-semibold"
                                            style={{ background: c.status === "active" ? "#2ecc7122" : "#95a5a622", color: c.status === "active" ? "#2ecc71" : "#95a5a6" }}
                                        >{c.status}</span>
                                    </td>
                                    <td className="p-2.5 text-muted-foreground">{c.channel}</td>
                                    <td className="p-2.5 font-semibold">{c.total_leads}</td>
                                    <td className="p-2.5">{c.qualified_leads}</td>
                                    <td className="p-2.5 text-red-500 font-semibold">{c.hot_leads}</td>
                                    <td className="p-2.5 text-emerald-500 font-semibold">{c.converted}</td>
                                    <td className="p-2.5">{c.avg_score || "—"}</td>
                                    <td className="p-2.5 font-semibold" style={{ color: parseFloat(c.conversion_rate) > 0 ? "#2ecc71" : undefined }}>
                                        {c.conversion_rate || 0}%
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="text-center py-10 text-muted-foreground">
                        {loading ? tc("loading") : tc("noData")}
                    </div>
                )}
            </div>

            {/* CRM Quick Stats */}
            {crmStats && (
                <div className="mt-6 grid grid-cols-3 gap-3">
                    <div className="p-4 rounded-[14px] border border-border bg-card">
                        <div className="text-xs text-muted-foreground mb-1">Oportunidades Totales</div>
                        <div className="text-[22px] font-semibold">{crmStats.opportunities?.total || 0}</div>
                    </div>
                    <div className="p-4 rounded-[14px] border border-border bg-card">
                        <div className="text-xs text-muted-foreground mb-1">Valor Total Pipeline</div>
                        <div className="text-[22px] font-semibold">${(crmStats.opportunities?.totalValue || 0).toLocaleString()}</div>
                    </div>
                    <div className="p-4 rounded-[14px] border border-border bg-card">
                        <div className="text-xs text-muted-foreground mb-1">Win Rate</div>
                        <div className="text-[22px] font-semibold text-emerald-500">{crmStats.opportunities?.winRate || 0}%</div>
                    </div>
                </div>
            )}
        </div>
    );
}
